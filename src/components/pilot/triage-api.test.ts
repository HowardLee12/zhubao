import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PilotApiError } from "./api";
import {
  cancelServiceRequest,
  createCustomer,
  convertServiceRequest,
  declineServiceRequest,
  fetchCustomerAssets,
  fetchCustomerLocations,
  fetchOrganizationMembers,
  fetchServiceRequestDetail,
  fetchSimilarCustomers,
  patchServiceRequestSummary,
  triageServiceRequest,
} from "./triage-api";

const organizationId = "20000000-0000-4000-8000-000000000001";
const requestId = "80000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit];
}

function headerValue(init: RequestInit, name: string): string | undefined {
  const headers = init.headers as Record<string, string> | undefined;
  return headers?.[name];
}

describe("triage-api client helpers", () => {
  beforeEach(() => {
    document.cookie = "renoly-csrf=0123456789abcdef0123456789abcdef; Path=/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the request detail from the envelope data field", async () => {
    const detail = { id: requestId, subject: "冷氣異味", lockVersion: 3 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: detail }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchServiceRequestDetail(organizationId, requestId);

    expect(result).toEqual(detail);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(
      `/api/v2/organizations/${organizationId}/service-requests/${requestId}`,
    );
    expect(init.method).toBe("GET");
  });

  it("PATCHes the summary with If-Match and CSRF headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { id: requestId, lockVersion: 4 } }));
    vi.stubGlobal("fetch", fetchMock);

    await patchServiceRequestSummary(organizationId, requestId, 3, {
      subject: "冷氣異味（已整理）",
      description: "兩台分離式冷氣",
      contactName: "林太太",
      contactPhone: "+886912345678",
    });

    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(
      `/api/v2/organizations/${organizationId}/service-requests/${requestId}`,
    );
    expect(init.method).toBe("PATCH");
    expect(headerValue(init, "If-Match")).toBe('"3"');
    expect(headerValue(init, "X-CSRF-Token")).toBe(
      "0123456789abcdef0123456789abcdef",
    );
  });

  it("triages with the customer binding and If-Match", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { id: requestId, status: "triaged" } }));
    vi.stubGlobal("fetch", fetchMock);

    await triageServiceRequest(organizationId, requestId, 2, {
      customerId: "90000000-0000-4000-8000-000000000001",
      locationId: "91000000-0000-4000-8000-000000000001",
      priority: "high",
      category: "cooling",
    });

    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(
      `/api/v2/organizations/${organizationId}/service-requests/${requestId}/actions/triage`,
    );
    expect(init.method).toBe("POST");
    expect(headerValue(init, "If-Match")).toBe('"2"');
    expect(headerValue(init, "X-CSRF-Token")).toBeTruthy();
    expect(JSON.parse(init.body as string)).toMatchObject({
      customerId: "90000000-0000-4000-8000-000000000001",
      priority: "high",
      category: "cooling",
    });
  });

  it("converts with both If-Match and Idempotency-Key and returns the envelope", async () => {
    const envelope = {
      serviceRequest: {
        id: requestId,
        status: "converted",
        lockVersion: 5,
        convertedAt: "2026-07-19T06:00:00.000Z",
      },
      project: null,
      workOrder: { id: "wo-1", workOrderNo: "WO-202607-000001", title: "冷氣清洗", status: "draft" },
      replayed: false,
    };
    // The convert route wraps the envelope in the standard { data } response.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: envelope }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const result = await convertServiceRequest(organizationId, requestId, 4, "idem-key-1234", {
      mode: "singleVisit",
      workOrder: { title: "冷氣清洗" },
    });

    expect(result).toEqual(envelope);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(
      `/api/v2/organizations/${organizationId}/service-requests/${requestId}/actions/convert`,
    );
    expect(headerValue(init, "If-Match")).toBe('"4"');
    expect(headerValue(init, "Idempotency-Key")).toBe("idem-key-1234");
    expect(headerValue(init, "X-CSRF-Token")).toBeTruthy();
  });

  it("declines with a reason body and If-Match", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { id: requestId, status: "declined" } }));
    vi.stubGlobal("fetch", fetchMock);

    await declineServiceRequest(organizationId, requestId, 1, "不在服務範圍");

    const [url, init] = lastCall(fetchMock);
    expect(url).toContain("/actions/decline");
    expect(headerValue(init, "If-Match")).toBe('"1"');
    expect(JSON.parse(init.body as string)).toEqual({ reason: "不在服務範圍" });
  });

  it("cancels with a reason body and If-Match", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { id: requestId, status: "cancelled" } }));
    vi.stubGlobal("fetch", fetchMock);

    await cancelServiceRequest(organizationId, requestId, 1, "客戶自行取消");

    const [url, init] = lastCall(fetchMock);
    expect(url).toContain("/actions/cancel");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "客戶自行取消" });
  });

  it("throws a PilotApiError with the problem detail on a 412 conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: "已被他人更新" }, 412));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      triageServiceRequest(organizationId, requestId, 2, {
        customerId: "90000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toMatchObject({ status: 412, message: "已被他人更新" } satisfies Partial<PilotApiError>);
  });

  it("queries similar customers and returns the data array", async () => {
    const rows = [
      { customerId: "c1", customerNo: "C-1", name: "林太太", phone: "+886912345678", matchReason: "phone" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: rows }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSimilarCustomers(organizationId, {
      phone: "+886912345678",
      name: "林太太",
    });

    expect(result).toEqual(rows);
    const [url] = lastCall(fetchMock);
    expect(url).toContain("/customers/similar?");
    expect(url).toContain("phone=");
    expect(url).toContain("name=");
  });

  it("creates a customer with CSRF protection and unwraps the real record", async () => {
    const customer = {
      id: "90000000-0000-4000-8000-000000000001",
      customerNo: "CU-202607-000001",
      name: "林太太",
      phone: "+886912345678",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: customer }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCustomer(organizationId, {
      name: "林太太",
      phone: "+886912345678",
    });

    expect(result).toEqual(customer);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(`/api/v2/organizations/${organizationId}/customers`);
    expect(init.method).toBe("POST");
    expect(headerValue(init, "X-CSRF-Token")).toBeTruthy();
    expect(JSON.parse(init.body as string)).toEqual({
      name: "林太太",
      phone: "+886912345678",
    });
  });

  it("skips the similar-customer request when no criteria are provided", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSimilarCustomers(organizationId, { phone: "", name: null });

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches customer locations and assets", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "loc-1" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "asset-1" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const locations = await fetchCustomerLocations(organizationId, "cust-1");
    const assets = await fetchCustomerAssets(organizationId, "cust-1");

    expect(locations).toEqual([{ id: "loc-1" }]);
    expect(assets).toEqual([{ id: "asset-1" }]);
    expect(fetchMock.mock.calls[0][0]).toContain("/customers/cust-1/locations");
    expect(fetchMock.mock.calls[1][0]).toContain("/customers/cust-1/assets");
  });

  it("fetches assignable organization members", async () => {
    const members = [{ id: "m1", displayName: "阿明", role: "technician", status: "active" }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: members }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchOrganizationMembers(organizationId);

    expect(result).toEqual(members);
    expect(lastCall(fetchMock)[0]).toContain("/members");
  });
});
