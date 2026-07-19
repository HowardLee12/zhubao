import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, createSignedUploadUrl, download, from, createAdminSupabaseClient } = vi.hoisted(
  () => {
    const rpc = vi.fn();
    const createSignedUploadUrl = vi.fn();
    const download = vi.fn();
    const from = vi.fn(() => ({ createSignedUploadUrl, download }));
    const createAdminSupabaseClient = vi.fn(() => ({ rpc, storage: { from } }));
    return { rpc, createSignedUploadUrl, download, from, createAdminSupabaseClient };
  },
);

vi.mock("@/server/supabase/admin", () => ({ createAdminSupabaseClient }));

import {
  completePublicIntakePhotoUpload,
  createPublicIntakePhotoUpload,
  resolvePublicIntakeConfig,
  submitPublicServiceRequest,
} from "./gateway";

const tokenHash = "a".repeat(64);
const clientIpHash = "b".repeat(64);
const submissionId = "4c76d4c5-c978-4bdb-a918-caa82988e5fa";
const photoId = "e75d3329-f791-4c92-bad7-cd76408b23fc";

describe("pilot public intake gateway", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("maps the public configuration RPC into a strict allowlisted DTO", async () => {
    rpc.mockResolvedValue({
      data: {
        merchantName: "北城工程",
        headline: "描述需求，我們確認後聯絡您",
        privacyNotice: "資料僅供本次服務聯繫使用。",
        serviceCatalogItems: [{ id: photoId, name: "現場估價", category: "裝修" }],
      },
      error: null,
    });

    await expect(resolvePublicIntakeConfig(tokenHash)).resolves.toEqual({
      merchantName: "北城工程",
      headline: "描述需求，我們確認後聯絡您",
      privacyNotice: "資料僅供本次服務聯繫使用。",
      serviceCatalogItems: [{ id: photoId, name: "現場估價", category: "裝修" }],
      photoLimit: 3,
      acceptedPhotoTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    expect(rpc).toHaveBeenCalledWith("resolve_pilot_intake_config", {
      p_public_intake_token_hash_hex: tokenHash,
    });
  });

  it("rejects internal fields leaking from the configuration RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        merchantName: "北城工程",
        headline: "描述需求",
        privacyNotice: "資料僅供本次服務聯繫使用。",
        serviceCatalogItems: [],
        settings: { defaultCostMinor: 12000 },
      },
      error: null,
    });

    await expect(resolvePublicIntakeConfig(tokenHash)).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
  });

  it("maps invalid capabilities to the same public 404", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "PILOT_PUBLIC_LINK_NOT_FOUND" },
    });

    await expect(resolvePublicIntakeConfig(tokenHash)).rejects.toMatchObject({
      status: 404,
      code: "PUBLIC_LINK_NOT_FOUND",
    });
  });

  it("reserves a private object and returns only a short-lived signed upload instruction", async () => {
    rpc.mockResolvedValue({
      data: {
        uploadId: photoId,
        submissionId,
        storageBucket: "v2-intake-photos",
        storagePath: `pilot/${submissionId}/${photoId}`,
        status: "pending",
        expiresAt: "2026-07-16T10:30:00.000Z",
        maxByteSize: 10485760,
      },
      error: null,
    });
    createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.test/signed-upload", token: "do-not-return" },
      error: null,
    });

    await expect(
      createPublicIntakePhotoUpload({
        tokenHash,
        clientIpHash,
        submissionId,
        filename: "漏水處.jpg",
        contentType: "image/jpeg",
        byteSize: 2048,
        sha256: "c".repeat(64),
      }),
    ).resolves.toEqual({
      photoId,
      upload: {
        method: "PUT",
        url: "https://storage.test/signed-upload",
        headers: { "x-upsert": "false" },
        // The signed-upload lifetime reflects the DB-pinned 30-minute expiry
        // (clock_timestamp() + 30 minutes) returned by the RPC, not a longer
        // TS-side value that would outlive the database reservation.
        expiresAt: "2026-07-16T10:30:00.000Z",
      },
    });
    expect(from).toHaveBeenCalledWith("v2-intake-photos");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(`pilot/${submissionId}/${photoId}`, {
      upsert: false,
    });
  });

  it("downloads and verifies actual bytes before completing a photo", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const sha256 = createHash("sha256").update(png).digest("hex");
    rpc
      .mockResolvedValueOnce({
        data: {
          uploadId: photoId,
          storageBucket: "v2-intake-photos",
          storagePath: `pilot/${submissionId}/${photoId}`,
          declaredMimeType: "image/png",
          declaredByteSize: png.byteLength,
          declaredSha256: sha256,
          status: "uploaded",
          expiresAt: "2026-07-16T12:00:00.000Z",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          uploadId: photoId,
          status: "ready",
          byteSize: png.byteLength,
          width: 1,
          height: 1,
          readyAt: "2026-07-16T10:00:01.000Z",
        },
        error: null,
      });
    download.mockResolvedValue({ data: new Blob([png], { type: "text/plain" }), error: null });

    await expect(
      completePublicIntakePhotoUpload({
        tokenHash,
        submissionId,
        photoId,
        idempotencyKey: "complete-photo-0001",
      }),
    ).resolves.toEqual({ photoId, status: "ready" });
    expect(rpc).toHaveBeenLastCalledWith("complete_pilot_intake_upload", {
      p_public_intake_token_hash_hex: tokenHash,
      p_intake_id: submissionId,
      p_upload_id: photoId,
      p_actual_mime_type: "image/png",
      p_actual_byte_size: png.byteLength,
      p_actual_sha256: sha256,
      p_image_width: 1,
      p_image_height: 1,
    });
  });

  it("submits an atomic service request and maps the safe receipt", async () => {
    rpc.mockResolvedValue({
      data: {
        serviceRequestId: submissionId,
        requestNo: "SR-2026-00001",
        status: "new",
        createdAt: "2026-07-16T10:00:00.000Z",
      },
      error: null,
    });

    await expect(
      submitPublicServiceRequest({
        tokenHash,
        submissionId,
        idempotencyKey: "browser-request-0001",
        clientIpHash,
        requestBody: {
          serviceCatalogItemId: photoId,
          contactName: "王先生",
          contactPhone: "+886912345678",
          subject: "浴室牆面滲水",
          description: "下雨後有水痕",
          address: { addressLine: "民生東路四段 88 號" },
          preferredWindows: [
            {
              startsAt: "2026-08-10T01:00:00.000Z",
              endsAt: "2026-08-10T04:00:00.000Z",
              preferenceRank: 1,
            },
          ],
        },
        photoIds: [photoId],
      }),
    ).resolves.toEqual({
      referenceNo: "SR-2026-00001",
      receivedAt: "2026-07-16T10:00:00.000Z",
      message: expect.any(String),
    });

    expect(rpc).toHaveBeenCalledWith("submit_pilot_service_request", {
      p_public_intake_token_hash_hex: tokenHash,
      p_intake_id: submissionId,
      p_idempotency_key: "browser-request-0001",
      p_client_ip_hash_hex: clientIpHash,
      p_request_body: expect.objectContaining({ subject: "浴室牆面滲水" }),
      p_upload_ids: [photoId],
    });
  });

  it("maps a reused submission id (session conflict) to a 409 problem", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "PILOT_INTAKE_SESSION_CONFLICT" },
    });

    await expect(
      submitPublicServiceRequest({
        tokenHash,
        submissionId,
        idempotencyKey: "browser-request-0002",
        clientIpHash,
        requestBody: {
          serviceCatalogItemId: photoId,
          contactName: "王先生",
          contactPhone: "+886912345678",
          subject: "浴室牆面滲水",
          description: "下雨後有水痕",
          address: { addressLine: "民生東路四段 88 號" },
          preferredWindows: [],
        },
        photoIds: [],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "INTAKE_SESSION_CONFLICT",
    });
  });
});
