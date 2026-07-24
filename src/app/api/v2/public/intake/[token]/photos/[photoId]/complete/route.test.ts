import { afterEach, describe, expect, it, vi } from "vitest";

const { completePublicIntakePhotoUpload } = vi.hoisted(() => ({
  completePublicIntakePhotoUpload: vi.fn(),
}));

vi.mock("@/server/public-intake/gateway", () => ({
  completePublicIntakePhotoUpload,
}));

import { POST } from "./route";

const token = "x".repeat(43);
const photoId = "e75d3329-f791-4c92-bad7-cd76408b23fc";
const submissionId = "4c76d4c5-c978-4bdb-a918-caa82988e5fa";

describe("POST /api/v2/public/intake/:token/photos/:photoId/complete", () => {
  afterEach(() => vi.clearAllMocks());

  it("verifies a private upload without accepting storage metadata from the browser", async () => {
    completePublicIntakePhotoUpload.mockResolvedValue({ photoId, status: "ready" });

    const response = await POST(
      new Request(`https://renoly.test/api/v2/public/intake/${token}/photos/${photoId}/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "complete-photo-0001",
        },
        body: JSON.stringify({ submissionId }),
      }),
      { params: Promise.resolve({ token, photoId }) },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { photoId, status: "ready" } });
    expect(completePublicIntakePhotoUpload).toHaveBeenCalledWith({
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      submissionId,
      photoId,
      idempotencyKey: "complete-photo-0001",
    });
    expect(JSON.stringify(completePublicIntakePhotoUpload.mock.calls)).not.toContain(token);
  });

  it("rejects non-UUID photo identifiers before storage lookup", async () => {
    const response = await POST(
      new Request(`https://renoly.test/api/v2/public/intake/${token}/photos/not-a-uuid/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "complete-photo-0001",
        },
        body: JSON.stringify({ submissionId }),
      }),
      { params: Promise.resolve({ token, photoId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(422);
    expect(completePublicIntakePhotoUpload).not.toHaveBeenCalled();
  });
});
