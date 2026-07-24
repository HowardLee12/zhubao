import { createHash } from "node:crypto";

import { imageSize } from "image-size";
import { z } from "zod";

import {
  PUBLIC_INTAKE_PHOTO_LIMIT,
  PUBLIC_INTAKE_PHOTO_MAX_BYTES,
  PUBLIC_INTAKE_PHOTO_TYPES,
  type PublicPhotoUploadRequest,
} from "@/schemas/public-intake";
import { ApiProblem } from "@/server/api/problem";
import { createAdminSupabaseClient } from "@/server/supabase/admin";

const HASH_HEX_SCHEMA = z.string().regex(/^[a-f0-9]{64}$/);
const PRIVATE_BUCKET = "v2-intake-photos";
// The database reservation (create_pilot_intake_upload) expires 30 minutes
// after creation. The signed upload URL must not advertise a longer lifetime
// than the DB row it depends on, so the ceiling mirrors the DB-pinned value.
const SIGNED_UPLOAD_LIFETIME_MS = 30 * 60 * 1000;

const catalogItemSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(120),
    category: z.string().min(1).max(120),
  })
  .strict();

// Mirrors the resolve_pilot_intake_config RPC return exactly. Photo limits and
// accepted MIME types are trusted server constants injected during mapping, so
// they are not part of the SQL contract.
const publicConfigurationSchema = z
  .object({
    merchantName: z.string().min(1).max(200),
    headline: z.string().min(1).max(200),
    privacyNotice: z.string().min(1).max(5_000),
    serviceCatalogItems: z.array(catalogItemSchema).max(50),
  })
  .strict();

const storageLocationSchema = z
  .object({
    uploadId: z.uuid(),
    storageBucket: z.literal(PRIVATE_BUCKET),
    storagePath: z
      .string()
      .min(1)
      .max(1_000)
      .refine((path) => !path.includes("..") && !path.startsWith("/"), "Invalid storage path"),
  })
  .strict();

// Mirrors the create_pilot_intake_upload RPC return exactly. Only the storage
// location fields are used downstream; the rest are modelled to keep .strict()
// honest against the real shape without a passthrough.
const uploadReservationSchema = storageLocationSchema
  .extend({
    submissionId: z.uuid(),
    status: z.enum(["pending", "uploaded", "ready"]),
    expiresAt: z.iso.datetime({ offset: true }),
    maxByteSize: z.number().int().min(1),
  })
  .strict();

const verificationSchema = storageLocationSchema
  .extend({
    declaredMimeType: z.enum(PUBLIC_INTAKE_PHOTO_TYPES),
    declaredByteSize: z.number().int().min(1).max(PUBLIC_INTAKE_PHOTO_MAX_BYTES),
    declaredSha256: HASH_HEX_SCHEMA,
    status: z.enum(["pending", "uploaded", "ready"]),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

// Mirrors the complete_pilot_intake_upload RPC return exactly. Only uploadId and
// status are surfaced to callers; the verified dimensions and timestamp stay
// server-side.
const photoReadySchema = z
  .object({
    uploadId: z.uuid(),
    status: z.literal("ready"),
    byteSize: z.number().int().min(1),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    readyAt: z.iso.datetime({ offset: true }),
  })
  .strict();

// Mirrors the submit_pilot_service_request RPC return exactly. The customer-safe
// receipt is derived from it; the internal serviceRequestId is not surfaced.
const submissionResultSchema = z
  .object({
    serviceRequestId: z.uuid(),
    requestNo: z.string().min(1).max(40),
    status: z.literal("new"),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const PUBLIC_RECEIPT_MESSAGE = "店家收到您的需求後會盡快與您聯絡。";

interface PublicRequestBody {
  serviceCatalogItemId: string;
  contactName: string;
  contactPhone: string;
  subject: string;
  description: string;
  address: {
    postalCode?: string;
    county?: string;
    district?: string;
    addressLine: string;
    accessNotes?: string;
  };
  preferredWindows: Array<{
    startsAt: string;
    endsAt: string;
    preferenceRank: number;
  }>;
}

interface PostgrestErrorLike {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}

function publicGatewayProblem(error: unknown): ApiProblem {
  const candidate = error as PostgrestErrorLike | null;
  const combined = [candidate?.message, candidate?.details, candidate?.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (combined.includes("PILOT_PUBLIC_LINK_NOT_FOUND")) {
    return new ApiProblem({
      status: 404,
      code: "PUBLIC_LINK_NOT_FOUND",
      title: "連結無法使用",
      detail: "此連結不存在、已過期或已被撤銷。",
    });
  }

  if (combined.includes("PILOT_UPLOAD_NOT_FOUND")) {
    return new ApiProblem({
      status: 404,
      code: "UPLOAD_NOT_FOUND",
      title: "找不到照片",
      detail: "照片不存在、已過期或不屬於這次填寫。",
    });
  }

  if (combined.includes("PILOT_RATE_LIMITED")) {
    return new ApiProblem({
      status: 429,
      code: "RATE_LIMITED",
      title: "要求過於頻繁",
      detail: "送出次數過多，請稍後再試。",
    });
  }

  if (combined.includes("PILOT_IDEMPOTENCY_CONFLICT")) {
    return new ApiProblem({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      title: "重複要求內容不一致",
      detail: "請重新整理頁面後再送出。",
    });
  }

  if (combined.includes("PILOT_INTAKE_SESSION_CONFLICT")) {
    return new ApiProblem({
      status: 409,
      code: "INTAKE_SESSION_CONFLICT",
      title: "這次填寫已送出",
      detail: "這份填寫已經送出過了，請重新整理頁面再建立新的需求。",
    });
  }

  if (
    combined.includes("PILOT_VALIDATION_FAILED") ||
    combined.includes("PILOT_UPLOAD_INVALID") ||
    combined.includes("PILOT_SERVICE_NOT_AVAILABLE")
  ) {
    return new ApiProblem({
      status: 422,
      code: "VALIDATION_FAILED",
      title: "輸入資料不正確",
      detail: "請檢查填寫內容與照片後再試一次。",
    });
  }

  return new ApiProblem({
    status: 500,
    code: "INTERNAL_ERROR",
    title: "系統暫時無法處理要求",
    detail: "系統暫時無法處理要求，請稍後再試。",
  });
}

function invalidUploadProblem(): ApiProblem {
  return new ApiProblem({
    status: 422,
    code: "UPLOAD_INVALID",
    title: "照片驗證失敗",
    detail: "照片內容與上傳資料不一致，請重新選擇照片。",
  });
}

function parseRpcData<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw publicGatewayProblem(result.error);
  }
  return result.data;
}

function actualImageMime(bytes: Uint8Array): (typeof PUBLIC_INTAKE_PHOTO_TYPES)[number] | null {
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
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function resolvePublicIntakeConfig(tokenHash: string) {
  HASH_HEX_SCHEMA.parse(tokenHash);
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc("resolve_pilot_intake_config", {
    p_public_intake_token_hash_hex: tokenHash,
  });

  if (error) throw publicGatewayProblem(error);

  const config = parseRpcData(publicConfigurationSchema, data);
  return {
    merchantName: config.merchantName,
    headline: config.headline,
    privacyNotice: config.privacyNotice,
    serviceCatalogItems: config.serviceCatalogItems,
    photoLimit: PUBLIC_INTAKE_PHOTO_LIMIT,
    acceptedPhotoTypes: [...PUBLIC_INTAKE_PHOTO_TYPES],
  };
}

interface CreatePhotoUploadCommand extends PublicPhotoUploadRequest {
  tokenHash: string;
  clientIpHash: string;
}

export async function createPublicIntakePhotoUpload(command: CreatePhotoUploadCommand) {
  HASH_HEX_SCHEMA.parse(command.tokenHash);
  HASH_HEX_SCHEMA.parse(command.clientIpHash);
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc("create_pilot_intake_upload", {
    p_public_intake_token_hash_hex: command.tokenHash,
    p_intake_id: command.submissionId,
    p_client_ip_hash_hex: command.clientIpHash,
    p_original_filename: command.filename,
    p_declared_mime_type: command.contentType,
    p_declared_byte_size: command.byteSize,
    p_declared_sha256: command.sha256,
  });
  if (error) throw publicGatewayProblem(error);

  const location = parseRpcData(uploadReservationSchema, data);
  const signed = await client.storage
    .from(location.storageBucket)
    .createSignedUploadUrl(location.storagePath, { upsert: false });
  if (signed.error || !signed.data?.signedUrl) {
    throw publicGatewayProblem(signed.error);
  }

  // Advertise the earlier of the DB reservation expiry and the TS ceiling so the
  // client is never told the upload window is longer than the database allows.
  const dbExpiryMs = Date.parse(location.expiresAt);
  const ceilingMs = Date.now() + SIGNED_UPLOAD_LIFETIME_MS;
  const expiresAtMs = Number.isNaN(dbExpiryMs) ? ceilingMs : Math.min(dbExpiryMs, ceilingMs);

  return {
    photoId: location.uploadId,
    upload: {
      method: "PUT" as const,
      url: signed.data.signedUrl,
      headers: { "x-upsert": "false" },
      expiresAt: new Date(expiresAtMs).toISOString(),
    },
  };
}

interface CompletePhotoUploadCommand {
  tokenHash: string;
  submissionId: string;
  photoId: string;
  idempotencyKey: string;
}

export async function completePublicIntakePhotoUpload(command: CompletePhotoUploadCommand) {
  const client = createAdminSupabaseClient();
  const verificationResult = await client.rpc("get_pilot_intake_upload_verification", {
    p_public_intake_token_hash_hex: command.tokenHash,
    p_intake_id: command.submissionId,
    p_upload_id: command.photoId,
  });
  if (verificationResult.error) throw publicGatewayProblem(verificationResult.error);

  const verification = parseRpcData(verificationSchema, verificationResult.data);
  if (verification.status === "ready") {
    return { photoId: verification.uploadId, status: "ready" as const };
  }
  if (Date.parse(verification.expiresAt) <= Date.now()) {
    throw publicGatewayProblem({ message: "PILOT_UPLOAD_NOT_FOUND" });
  }

  const downloaded = await client.storage
    .from(verification.storageBucket)
    .download(verification.storagePath);
  if (downloaded.error || !downloaded.data) {
    throw publicGatewayProblem(downloaded.error);
  }

  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const actualMimeType = actualImageMime(bytes);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  let dimensions: ReturnType<typeof imageSize>;
  try {
    dimensions = imageSize(bytes);
  } catch {
    throw invalidUploadProblem();
  }

  if (
    !actualMimeType ||
    actualMimeType !== verification.declaredMimeType ||
    bytes.byteLength !== verification.declaredByteSize ||
    actualSha256 !== verification.declaredSha256 ||
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width > 10_000 ||
    dimensions.height > 10_000 ||
    dimensions.width * dimensions.height > 25_000_000
  ) {
    throw invalidUploadProblem();
  }

  const completed = await client.rpc("complete_pilot_intake_upload", {
    p_public_intake_token_hash_hex: command.tokenHash,
    p_intake_id: command.submissionId,
    p_upload_id: command.photoId,
    p_actual_mime_type: actualMimeType,
    p_actual_byte_size: bytes.byteLength,
    p_actual_sha256: actualSha256,
    p_image_width: dimensions.width,
    p_image_height: dimensions.height,
  });
  if (completed.error) throw publicGatewayProblem(completed.error);

  const ready = parseRpcData(photoReadySchema, completed.data);
  return { photoId: ready.uploadId, status: ready.status };
}

interface SubmitPublicServiceRequestCommand {
  tokenHash: string;
  submissionId: string;
  idempotencyKey: string;
  clientIpHash: string;
  requestBody: PublicRequestBody;
  photoIds: string[];
}

export async function submitPublicServiceRequest(command: SubmitPublicServiceRequestCommand) {
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc("submit_pilot_service_request", {
    p_public_intake_token_hash_hex: command.tokenHash,
    p_intake_id: command.submissionId,
    p_idempotency_key: command.idempotencyKey,
    p_client_ip_hash_hex: command.clientIpHash,
    p_request_body: command.requestBody,
    p_upload_ids: command.photoIds,
  });
  if (error) throw publicGatewayProblem(error);

  const result = parseRpcData(submissionResultSchema, data);
  return {
    referenceNo: result.requestNo,
    receivedAt: result.createdAt,
    message: PUBLIC_RECEIPT_MESSAGE,
  };
}
