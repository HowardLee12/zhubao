import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createPublicIntakePhotoUpload } = vi.hoisted(() => ({
  createPublicIntakePhotoUpload: vi.fn(),
}));

vi.mock("@/server/public-intake/gateway", () => ({
  createPublicIntakePhotoUpload,
}));

import { POST } from "./route";

const token = "x".repeat(43);
const body = {
  submissionId: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
  filename: "漏水處.jpg",
  contentType: "image/jpeg",
  byteSize: 2048,
  sha256: "a".repeat(64),
};

describe("POST /api/v2/public/intake/:token/photo-uploads", () => {
  beforeEach(() => {
    process.env.PUBLIC_TOKEN_PEPPER = "pilot-test-pepper-that-is-longer-than-32-bytes";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.PUBLIC_TOKEN_PEPPER;
  });

  it("reserves a private upload using only capability and IP hashes", async () => {
    createPublicIntakePhotoUpload.mockResolvedValue({
      photoId: "e75d3329-f791-4c92-bad7-cd76408b23fc",
      upload: {
        method: "PUT",
        url: "https://storage.test/signed-upload",
        headers: { "content-type": "image/jpeg" },
        expiresAt: "2026-07-16T10:10:00.000Z",
      },
    });

    const response = await POST(
      new Request(`https://renoly.test/api/v2/public/intake/${token}/photo-uploads`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.7",
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ token }) },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      data: expect.objectContaining({
        photoId: "e75d3329-f791-4c92-bad7-cd76408b23fc",
      }),
    });
    expect(createPublicIntakePhotoUpload).toHaveBeenCalledWith({
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      clientIpHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      ...body,
    });
    expect(JSON.stringify(createPublicIntakePhotoUpload.mock.calls)).not.toContain("203.0.113.7");
    expect(JSON.stringify(createPublicIntakePhotoUpload.mock.calls)).not.toContain(token);
  });

  it("rejects unsupported image declarations before storage is touched", async () => {
    const response = await POST(
      new Request(`https://renoly.test/api/v2/public/intake/${token}/photo-uploads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, contentType: "image/heic" }),
      }),
      { params: Promise.resolve({ token }) },
    );

    expect(response.status).toBe(422);
    expect(createPublicIntakePhotoUpload).not.toHaveBeenCalled();
  });
});
