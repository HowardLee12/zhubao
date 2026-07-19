import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { submitPublicServiceRequest } = vi.hoisted(() => ({
  submitPublicServiceRequest: vi.fn(),
}));

vi.mock("@/server/public-intake/gateway", () => ({
  submitPublicServiceRequest,
}));

import { POST } from "./route";

const validToken = "x".repeat(43);
const validBody = {
  submissionId: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
  contactName: "王先生",
  contactPhone: "0912 345 678",
  serviceCatalogItemId: "2f66bf0a-b8d9-4722-9e2a-23f218f25d86",
  title: "浴室牆面滲水",
  description: "下雨後靠窗牆面有水痕",
  address: {
    county: "台北市",
    district: "松山區",
    addressLine: "民生東路四段 88 號",
  },
  preferredWindows: [
    {
      startsAt: "2026-08-10T01:00:00.000Z",
      endsAt: "2026-08-10T04:00:00.000Z",
      preferenceRank: 1,
    },
  ],
  photoIds: ["e75d3329-f791-4c92-bad7-cd76408b23fc"],
  privacyAccepted: true,
  companyWebsite: "",
};

describe("POST /api/v2/public/intake/:token/service-requests", () => {
  beforeEach(() => {
    process.env.PUBLIC_TOKEN_PEPPER = "pilot-test-pepper-that-is-longer-than-32-bytes";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.PUBLIC_TOKEN_PEPPER;
  });

  it("accepts a validated request and passes only hashes to the privileged gateway", async () => {
    submitPublicServiceRequest.mockResolvedValue({
      referenceNo: "SR-2026-00001",
      receivedAt: "2026-07-16T10:00:00.000Z",
      message: "店家確認後會與您聯絡。",
    });

    const response = await POST(
      new Request(`https://renoly.test/api/v2/public/intake/${validToken}/service-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "browser-request-0001",
          "x-forwarded-for": "203.0.113.7",
        },
        body: JSON.stringify(validBody),
      }),
      { params: Promise.resolve({ token: validToken }) },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      data: {
        referenceNo: "SR-2026-00001",
        receivedAt: "2026-07-16T10:00:00.000Z",
        message: "店家確認後會與您聯絡。",
      },
    });
    expect(submitPublicServiceRequest).toHaveBeenCalledWith({
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      submissionId: validBody.submissionId,
      idempotencyKey: "browser-request-0001",
      clientIpHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestBody: {
        serviceCatalogItemId: validBody.serviceCatalogItemId,
        contactName: validBody.contactName,
        contactPhone: "+886912345678",
        subject: validBody.title,
        description: validBody.description,
        address: validBody.address,
        preferredWindows: validBody.preferredWindows,
      },
      photoIds: validBody.photoIds,
    });
    expect(JSON.stringify(submitPublicServiceRequest.mock.calls)).not.toContain("203.0.113.7");
    expect(JSON.stringify(submitPublicServiceRequest.mock.calls)).not.toContain(validToken);
  });

  it("requires an idempotency key before calling the gateway", async () => {
    const response = await POST(
      new Request(`https://renoly.test/api/v2/public/intake/${validToken}/service-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      { params: Promise.resolve({ token: validToken }) },
    );

    expect(response.status).toBe(428);
    expect(submitPublicServiceRequest).not.toHaveBeenCalled();
  });

  it("rejects honeypot and unknown fields before calling the gateway", async () => {
    const response = await POST(
      new Request(`https://renoly.test/api/v2/public/intake/${validToken}/service-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "browser-request-0001",
        },
        body: JSON.stringify({ ...validBody, companyWebsite: "spam", organizationId: "leak" }),
      }),
      { params: Promise.resolve({ token: validToken }) },
    );

    expect(response.status).toBe(422);
    expect(submitPublicServiceRequest).not.toHaveBeenCalled();
  });
});
