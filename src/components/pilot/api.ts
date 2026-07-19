import type { PilotInboxItem } from "@/schemas/pilot-inbox";

export type { PilotInboxItem };

export type IndustryTemplate =
  | "general_field_service"
  | "cooling"
  | "plumbing"
  | "waterproofing"
  | "renovation";

export interface PilotMembership {
  id: string;
  organizationId: string;
  displayName: string;
  role: "owner" | "admin" | "dispatcher" | "technician" | "accountant" | "viewer";
  status: "invited" | "active" | "suspended" | "removed";
}

export interface PilotSession {
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  memberships: PilotMembership[];
}

export interface CreatePilotOrganizationInput {
  name: string;
  slug: string;
  ownerDisplayName: string;
  industryTemplate: IndustryTemplate;
  timezone: string;
  currency: "TWD";
}

export interface PilotOrganizationCreated {
  organization: {
    id: string;
    name: string;
    industryTemplate: IndustryTemplate;
  };
  membership: PilotMembership;
  publicIntakeUrl: string;
}

export interface PilotInboxPage {
  data: PilotInboxItem[];
  meta: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface PilotOrganizationSettings {
  organizationId: string;
  name: string;
  industryTemplate: IndustryTemplate;
  intakeHeadline: string;
  privacyNotice: string;
  lockVersion: number;
}

export interface UpdatePilotOrganizationSettingsInput {
  name: string;
  intakeHeadline: string;
  privacyNotice: string;
  lockVersion: number;
}

export type AcceptedPhotoType = "image/jpeg" | "image/png" | "image/webp";

export interface PublicIntakeConfiguration {
  submissionId: string;
  merchantName: string;
  headline: string;
  serviceCatalogItems: Array<{
    id: string;
    name: string;
    category: string;
  }>;
  photoLimit: number;
  acceptedPhotoTypes: AcceptedPhotoType[];
  privacyNotice: string;
}

export interface PublicIntakeSubmission {
  submissionId: string;
  contactName: string;
  contactPhone: string;
  serviceCatalogItemId: string;
  title: string;
  description: string;
  address: {
    addressLine: string;
  };
  preferredWindows: Array<{
    startsAt: string;
    endsAt: string;
    preferenceRank: number;
  }>;
  photoIds: string[];
  privacyAccepted: true;
  companyWebsite: string;
}

export interface PublicIntakeReceipt {
  referenceNo: string;
  receivedAt: string;
  message: string;
}

interface PhotoUploadInstruction {
  photoId: string;
  upload: {
    method: "PUT";
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  };
}

interface ProblemDetails {
  title?: string;
  detail?: string;
}

const CSRF_COOKIE_NAME = "renoly-csrf";

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === CSRF_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Return the double-submit CSRF token, minting and persisting one in a
 * JS-readable cookie on first use so the browser can echo it back in the
 * `X-CSRF-Token` header of every cookie-authenticated staff mutation. The
 * cookie is deliberately not HttpOnly (double-submit requires client read);
 * secrecy is not what protects it — an attacker's cross-site request cannot read
 * this cookie's value to forge a matching header.
 */
function randomCsrfToken(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.getRandomValues === "function") {
    return cryptoApi
      .getRandomValues(new Uint8Array(32))
      .reduce((acc, byte) => acc + byte.toString(16).padStart(2, "0"), "");
  }
  // Fallback: two CSPRNG-backed UUIDs (each 122 bits of entropy) with hyphens
  // stripped comfortably exceed the 32-char minimum.
  return `${cryptoApi.randomUUID()}${cryptoApi.randomUUID()}`.replaceAll("-", "");
}

export function ensureCsrfToken(): string {
  const existing = readCsrfCookie();
  if (existing && existing.length >= 32) return existing;

  const token = randomCsrfToken();

  if (typeof document !== "undefined") {
    const secure = globalThis.location?.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${CSRF_COOKIE_NAME}=${token}; Path=/; SameSite=Lax; Max-Age=86400${secure}`;
  }
  return token;
}

export class PilotApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PilotApiError";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | ProblemDetails | null;

  if (!response.ok) {
    const problem = body as ProblemDetails | null;
    throw new PilotApiError(
      problem?.detail ?? problem?.title ?? "服務暫時無法使用，請稍後再試。",
      response.status,
    );
  }

  return body as T;
}

export async function fetchPilotSession(): Promise<PilotSession> {
  const response = await fetch("/api/v2/session", {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const envelope = await readJson<{ data: PilotSession }>(response);
  return envelope.data;
}

export async function createPilotOrganization(
  input: CreatePilotOrganizationInput,
  idempotencyKey: string,
): Promise<PilotOrganizationCreated> {
  const response = await fetch("/api/v2/organizations", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-CSRF-Token": ensureCsrfToken(),
    },
    body: JSON.stringify(input),
  });
  const envelope = await readJson<{ data: PilotOrganizationCreated }>(response);
  return envelope.data;
}

export interface FetchPilotInboxOptions {
  status?: string;
  cursor?: string | null;
  limit?: number;
}

export async function fetchPilotInbox(
  organizationId: string,
  options: FetchPilotInboxOptions = {},
): Promise<PilotInboxPage> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.cursor) params.set("cursor", options.cursor);
  params.set("limit", String(options.limit ?? 20));

  const response = await fetch(
    `/api/v2/organizations/${encodeURIComponent(organizationId)}/service-requests?${params.toString()}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  );
  return readJson<PilotInboxPage>(response);
}

export async function fetchPilotOrganizationSettings(
  organizationId: string,
): Promise<PilotOrganizationSettings> {
  const response = await fetch(
    `/api/v2/organizations/${encodeURIComponent(organizationId)}/settings`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  );
  const envelope = await readJson<{ data: PilotOrganizationSettings }>(response);
  return envelope.data;
}

export async function updatePilotOrganizationSettings(
  organizationId: string,
  input: UpdatePilotOrganizationSettingsInput,
): Promise<PilotOrganizationSettings> {
  const response = await fetch(
    `/api/v2/organizations/${encodeURIComponent(organizationId)}/settings`,
    {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": ensureCsrfToken(),
      },
      body: JSON.stringify(input),
    },
  );
  const envelope = await readJson<{ data: PilotOrganizationSettings }>(response);
  return envelope.data;
}

export async function rotatePilotPublicIntakeLink(
  organizationId: string,
  idempotencyKey: string,
): Promise<string> {
  const response = await fetch(
    `/api/v2/organizations/${encodeURIComponent(organizationId)}/public-intake-link/actions/rotate`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-CSRF-Token": ensureCsrfToken(),
      },
    },
  );
  const envelope = await readJson<{ data: { publicIntakeUrl: string } }>(response);
  return envelope.data.publicIntakeUrl;
}

export async function fetchPublicIntakeConfiguration(
  token: string,
): Promise<PublicIntakeConfiguration> {
  const response = await fetch(`/api/v2/public/intake/${encodeURIComponent(token)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const envelope = await readJson<{ data: PublicIntakeConfiguration }>(response);
  return envelope.data;
}

export async function createPublicPhotoUpload(
  token: string,
  submissionId: string,
  file: File,
  sha256: string,
): Promise<PhotoUploadInstruction> {
  const response = await fetch(
    `/api/v2/public/intake/${encodeURIComponent(token)}/photo-uploads`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId,
        filename: file.name,
        contentType: file.type,
        byteSize: file.size,
        sha256,
      }),
    },
  );
  const envelope = await readJson<{ data: PhotoUploadInstruction }>(response);
  return envelope.data;
}

export async function uploadToSignedUrl(
  instruction: PhotoUploadInstruction["upload"],
  file: File,
): Promise<void> {
  const uploadBody = new FormData();
  uploadBody.append("cacheControl", "3600");
  uploadBody.append("", file);

  const response = await fetch(instruction.url, {
    method: instruction.method,
    headers: instruction.headers,
    body: uploadBody,
  });

  if (!response.ok) {
    throw new PilotApiError("照片上傳失敗，請檢查網路後再試。", response.status);
  }
}

export async function completePublicPhotoUpload(
  token: string,
  submissionId: string,
  photoId: string,
  idempotencyKey: string,
): Promise<void> {
  const response = await fetch(
    `/api/v2/public/intake/${encodeURIComponent(token)}/photos/${encodeURIComponent(photoId)}/complete`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ submissionId }),
    },
  );
  await readJson<unknown>(response);
}

export async function submitPublicIntake(
  token: string,
  input: PublicIntakeSubmission,
  idempotencyKey: string,
): Promise<PublicIntakeReceipt> {
  const response = await fetch(
    `/api/v2/public/intake/${encodeURIComponent(token)}/service-requests`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  const envelope = await readJson<{ data: PublicIntakeReceipt }>(response);
  return envelope.data;
}

export function createIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export async function sha256File(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
