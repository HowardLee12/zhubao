import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PilotApiError } from "./api";
import {
  captureWorkOrderPhoto,
  checkScheduleConflicts,
  completeChecklist,
  createWorkOrder,
  fetchScheduleWindow,
  fetchWorkOrderDetail,
  forceCompleteWorkOrder,
  listWorkOrders,
  respondToAssignment,
  respondToChecklistItem,
  scheduleWorkOrder,
  transitionWorkOrder,
} from "./work-order-api";

const organizationId = "20000000-0000-4000-8000-000000000001";
const workOrderId = "82000000-0000-4000-8000-000000000001";
const assignmentId = "83000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function problemResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit];
}

function headerValue(init: RequestInit, name: string): string | undefined {
  const headers = init.headers as Record<string, string> | undefined;
  return headers?.[name];
}

describe("work-order-api client helpers", () => {
  beforeEach(() => {
    document.cookie = "renoly-csrf=0123456789abcdef0123456789abcdef; Path=/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists work orders and returns the paged envelope", async () => {
    const page = { data: [{ id: workOrderId }], meta: { hasMore: false, nextCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(page));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listWorkOrders(organizationId, { status: "scheduled", pageSize: 10 });

    expect(result).toEqual(page);
    const [url, init] = lastCall(fetchMock);
    expect(url).toContain(`/api/v2/organizations/${organizationId}/work-orders?`);
    expect(url).toContain("status=scheduled");
    expect(url).toContain("pageSize=10");
    expect(init.method).toBe("GET");
  });

  it("passes assigneeId filter for technician-scoped lists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [], meta: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal("fetch", fetchMock);

    await listWorkOrders(organizationId, { assigneeId: "30000000-0000-4000-8000-000000000003" });
    const [url] = lastCall(fetchMock);
    expect(url).toContain("assigneeId=30000000-0000-4000-8000-000000000003");
  });

  it("fetches the schedule window from the data field", async () => {
    const items = [{ id: workOrderId, workOrderNo: "W-1" }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: items }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchScheduleWindow(
      organizationId,
      "2026-08-01T00:00:00Z",
      "2026-08-08T00:00:00Z",
    );

    expect(result).toEqual(items);
    const [url] = lastCall(fetchMock);
    expect(url).toContain("/schedule?");
    expect(url).toContain("from=2026-08-01");
  });

  it("fetches a work order detail from the data field", async () => {
    const detail = { id: workOrderId, lockVersion: 2, status: "scheduled" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: detail }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWorkOrderDetail(organizationId, workOrderId);
    expect(result).toEqual(detail);
    expect(lastCall(fetchMock)[1].method).toBe("GET");
  });

  it("creates a work order with an idempotency key and CSRF header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { id: workOrderId, lockVersion: 1 } }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createWorkOrder(organizationId, "idem-1", {
      customerId: "40000000-0000-4000-8000-000000000001",
      locationId: "50000000-0000-4000-8000-000000000001",
      title: "冷氣清洗",
    });

    const [url, init] = lastCall(fetchMock);
    expect(url).toBe(`/api/v2/organizations/${organizationId}/work-orders`);
    expect(init.method).toBe("POST");
    expect(headerValue(init, "Idempotency-Key")).toBe("idem-1");
    expect(headerValue(init, "X-CSRF-Token")).toBe("0123456789abcdef0123456789abcdef");
  });

  it("schedules a work order with If-Match and returns the notification envelope", async () => {
    const envelope = {
      data: { id: workOrderId, status: "scheduled", lockVersion: 2 },
      notification: { status: "not_sent", reason: "line_delivery_deferred_to_m6" },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(envelope));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scheduleWorkOrder(organizationId, workOrderId, 1, {
      scheduledStartAt: "2026-08-10T01:00:00Z",
      scheduledEndAt: "2026-08-10T03:00:00Z",
      occurredAt: "2026-07-19T00:00:00Z",
      assignments: [{ membershipId: "30000000-0000-4000-8000-000000000003", duty: "lead" }],
    });

    expect(result.notification.status).toBe("not_sent");
    const [url, init] = lastCall(fetchMock);
    expect(url).toContain("/actions/schedule");
    expect(headerValue(init, "If-Match")).toBe('"1"');
    expect(headerValue(init, "Idempotency-Key")).toBeTruthy();
  });

  it("surfaces a schedule conflict as a typed error carrying conflicts[]", async () => {
    const conflicts = [
      {
        membershipId: "30000000-0000-4000-8000-000000000003",
        workOrderId: "82000000-0000-4000-8000-000000000009",
        workOrderNo: "W-9",
        startsAt: "2026-08-10T01:00:00Z",
        endsAt: "2026-08-10T03:00:00Z",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      problemResponse(
        { title: "排程衝突", detail: "技師已有重疊工單。", conflicts },
        409,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      scheduleWorkOrder(organizationId, workOrderId, 1, {
        scheduledStartAt: "2026-08-10T01:00:00Z",
        scheduledEndAt: "2026-08-10T03:00:00Z",
        occurredAt: "2026-07-19T00:00:00Z",
        assignments: [{ membershipId: "30000000-0000-4000-8000-000000000003" }],
      }),
    ).rejects.toMatchObject({
      name: "ScheduleConflictError",
      status: 409,
      conflicts,
    });
  });

  it("surfaces a 412 stale If-Match as a typed PilotApiError so callers can refetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(problemResponse({ title: "資料已更新", detail: "請重新整理。" }, 412));
    vi.stubGlobal("fetch", fetchMock);

    const error = await transitionWorkOrder(organizationId, workOrderId, 1, "arrive").catch(
      (cause) => cause,
    );
    expect(error).toBeInstanceOf(PilotApiError);
    expect((error as PilotApiError).status).toBe(412);
  });

  it("builds a complete transition body with a completion summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { status: "completed", lockVersion: 5 },
        notification: { status: "not_sent", reason: "line_delivery_deferred_to_m6" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await transitionWorkOrder(organizationId, workOrderId, 4, "complete", {
      completionSummary: "清洗完成，運轉正常。",
      occurredAt: "2026-07-19T05:00:00Z",
    });

    const [, init] = lastCall(fetchMock);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      action: "complete",
      occurredAt: "2026-07-19T05:00:00Z",
      completionSummary: "清洗完成，運轉正常。",
    });
    expect(headerValue(init, "If-Match")).toBe('"4"');
  });

  it("carries the reason on cancel/reopen transitions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: { status: "cancelled" }, notification: { status: "not_sent", reason: "x" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await transitionWorkOrder(organizationId, workOrderId, 4, "cancel", { reason: "客戶取消" });
    const body = JSON.parse(lastCall(fetchMock)[1].body as string);
    expect(body.reason).toBe("客戶取消");
  });

  it("force-completes with reason + summary and returns the notification envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { id: workOrderId, status: "completed", customerSignedAt: null, lockVersion: 6 },
        notification: { status: "not_sent", reason: "line_delivery_deferred_to_m6" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await forceCompleteWorkOrder(organizationId, workOrderId, 5, {
      reason: "客戶臨時外出，改由現場負責人確認",
      completionSummary: "已完工，例外流程。",
    });

    expect(result.data.customerSignedAt).toBeNull();
    const [url, init] = lastCall(fetchMock);
    expect(url).toContain("/actions/force-complete");
    const body = JSON.parse(init.body as string);
    expect(body.reason).toBeTruthy();
    expect(body.completionSummary).toBeTruthy();
  });

  it("responds to an assignment (accept without reason)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { id: assignmentId, status: "accepted", lockVersion: 2 } }));
    vi.stubGlobal("fetch", fetchMock);

    await respondToAssignment(organizationId, assignmentId, 1, "accept");
    const body = JSON.parse(lastCall(fetchMock)[1].body as string);
    expect(body).toEqual({ decision: "accept" });
  });

  it("responds to an assignment (decline requires reason)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { id: assignmentId, status: "declined", lockVersion: 2 } }));
    vi.stubGlobal("fetch", fetchMock);

    await respondToAssignment(organizationId, assignmentId, 1, "decline", "當天已排休");
    const body = JSON.parse(lastCall(fetchMock)[1].body as string);
    expect(body).toEqual({ decision: "decline", reason: "當天已排休" });
  });

  it("checks schedule conflicts and returns the conflicts array", async () => {
    const conflicts = [{ membershipId: "m", workOrderId: "w", workOrderNo: "W-1", startsAt: null, endsAt: null }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { conflicts } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkScheduleConflicts(organizationId, {
      membershipIds: ["30000000-0000-4000-8000-000000000003"],
      startsAt: "2026-08-10T01:00:00Z",
      endsAt: "2026-08-10T03:00:00Z",
    });
    expect(result).toEqual(conflicts);
  });

  it("responds to a checklist item with the parent work-order If-Match", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { id: "item", workOrderId, response: true, lockVersion: 3 } }));
    vi.stubGlobal("fetch", fetchMock);

    await respondToChecklistItem(organizationId, "checklist", "item", 2, true);
    const [url, init] = lastCall(fetchMock);
    expect(url).toContain("/work-order-checklists/checklist/items/item");
    expect(init.method).toBe("PATCH");
    expect(headerValue(init, "If-Match")).toBe('"2"');
    expect(JSON.parse(init.body as string)).toEqual({ response: true });
  });

  it("completes a checklist with the parent work-order If-Match", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { checklistId: "c", workOrderId, status: "completed", completedAt: "2026-07-19T05:00:00Z" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await completeChecklist(organizationId, "c", 3);
    const [url, init] = lastCall(fetchMock);
    expect(url).toContain("/work-order-checklists/c/actions/complete");
    expect(headerValue(init, "If-Match")).toBe('"3"');
  });

  it("captures a photo: fingerprint -> reserve -> PUT -> complete", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "before.jpg", { type: "image/jpeg" });
    const digestMock = vi
      .fn()
      .mockResolvedValue(new Uint8Array(32).fill(0xab).buffer);
    vi.stubGlobal("crypto", {
      subtle: { digest: digestMock },
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            photoId: "90000000-0000-4000-8000-000000000001",
            upload: { method: "PUT", url: "https://signed.example/put", headers: {}, expiresAt: "z" },
          },
        }, 201),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { photoId: "90000000-0000-4000-8000-000000000001", status: "ready", category: "before" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await captureWorkOrderPhoto(organizationId, workOrderId, file, "before", {
      checklistItemId: null,
    });

    expect(result.photoId).toBe("90000000-0000-4000-8000-000000000001");
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    // reserve, PUT, complete = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const reserveBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(reserveBody.category).toBe("before");
    expect(reserveBody.sha256).toMatch(/^[0-9a-f]{64}$/);
    const putCall = fetchMock.mock.calls[1];
    expect(putCall[0]).toBe("https://signed.example/put");
    expect((putCall[1] as RequestInit).method).toBe("PUT");
  });

  it("rejects a non-image photo before any network call", async () => {
    const file = new File([new Uint8Array([1])], "note.txt", { type: "text/plain" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      captureWorkOrderPhoto(organizationId, workOrderId, file, "before"),
    ).rejects.toBeInstanceOf(PilotApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
