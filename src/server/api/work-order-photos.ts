import { createHash } from "node:crypto";

import { imageSize } from "image-size";

import { WORK_ORDER_PHOTO_TYPES } from "@/schemas/work-order-photo";
import { ApiProblem } from "@/server/api/problem";
import { createAdminSupabaseClient } from "@/server/supabase/admin";

const WORK_MEDIA_BUCKET = "work-media";
const SIGNED_URL_TTL_SECONDS = 300;
const SIGNED_UPLOAD_TTL_SECONDS = 600;

type WorkOrderPhotoMime = (typeof WORK_ORDER_PHOTO_TYPES)[number];

function invalidUploadProblem(): ApiProblem {
  return new ApiProblem({
    status: 422,
    code: "PHOTO_VERIFICATION_INVALID",
    title: "照片驗證失敗",
    detail: "照片內容與上傳資料不一致，請重新選擇照片。",
  });
}

// Magic-byte MIME sniff. The declared content type is never trusted; the real
// bytes decide the type before the DB cross-check flips pending -> ready.
export function actualWorkMediaMime(bytes: Uint8Array): WorkOrderPhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCodePoint(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCodePoint(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

// Mint a short-lived signed PUT URL for a reserved (pending) work-media object.
// The DB reservation already authorized the caller and pinned the storage path;
// this helper only signs the private bucket URL with the admin credential.
export async function signWorkMediaUploadUrl(
  storagePath: string,
): Promise<{ method: "PUT"; url: string; headers: Record<string, string>; expiresAt: string }> {
  const signer = createAdminSupabaseClient();
  const signed = await signer.storage
    .from(WORK_MEDIA_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false });
  if (signed.error || !signed.data?.signedUrl) {
    throw new ApiProblem({
      status: 500,
      code: "INTERNAL_ERROR",
      title: "系統暫時無法處理要求",
      detail: "系統暫時無法產生上傳連結，請稍後再試。",
    });
  }
  return {
    method: "PUT",
    url: signed.data.signedUrl,
    headers: { "x-upsert": "false" },
    expiresAt: new Date(Date.now() + SIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString(),
  };
}

// Mint a short-lived signed READ URL for a work-media object. The authenticated
// RPC (get_work_order_photo_read_url) has already authorized the caller and
// returned the storage path; this helper never queries a domain table and never
// logs the signed URL.
export async function signWorkMediaReadUrl(
  storagePath: string,
): Promise<{ url: string; expiresAt: string }> {
  const signer = createAdminSupabaseClient();
  const signed = await signer.storage
    .from(WORK_MEDIA_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    throw new ApiProblem({
      status: 404,
      code: "NOT_FOUND",
      title: "找不到照片",
      detail: "照片不存在或連結已失效。",
    });
  }
  return {
    url: signed.data.signedUrl,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

export interface VerifiedPhotoActuals {
  mimeType: WorkOrderPhotoMime;
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
}

// Download a reserved object from work-media and compute its real MIME (magic
// bytes), byte size, sha256 and dimensions. These actuals are then passed to
// complete_work_order_photo, which cross-checks them against the values declared
// at upload before flipping the row to ready.
export async function computeWorkMediaActuals(storagePath: string): Promise<VerifiedPhotoActuals> {
  const signer = createAdminSupabaseClient();
  const downloaded = await signer.storage.from(WORK_MEDIA_BUCKET).download(storagePath);
  if (downloaded.error || !downloaded.data) {
    throw invalidUploadProblem();
  }

  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const mimeType = actualWorkMediaMime(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  let dimensions: ReturnType<typeof imageSize>;
  try {
    dimensions = imageSize(bytes);
  } catch {
    throw invalidUploadProblem();
  }

  if (
    !mimeType ||
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width > 10_000 ||
    dimensions.height > 10_000 ||
    dimensions.width * dimensions.height > 25_000_000
  ) {
    throw invalidUploadProblem();
  }

  return {
    mimeType,
    byteSize: bytes.byteLength,
    sha256,
    width: dimensions.width,
    height: dimensions.height,
  };
}

export { WORK_MEDIA_BUCKET };
