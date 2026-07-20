import { createIdempotencyKey, ensureCsrfToken, PilotApiError } from "./api";

// Client API for the M6 staff surfaces: LINE channel connect/list + the
// notification outbox (list / retry / cancel). Credentials are sent to the server
// once on connect and NEVER returned — the DTO only carries credentialConfigured.

export interface LineChannelView {
  id: string;
  name: string;
  channelId: string;
  basicId: string | null;
  liffId: string | null;
  status: "pending" | "active" | "disabled" | "error";
  credentialConfigured: boolean;
  webhookVerifiedAt: string | null;
  lastWebhookAt: string | null;
  lastErrorCode: string | null;
  lockVersion: number;
}

export interface ConnectLineChannelInput {
  name: string;
  channelId: string;
  basicId?: string | null;
  liffId?: string | null;
  channelSecret: string;
  accessToken: string;
}

export interface NotificationView {
  id: string;
  channel: string;
  templateKey: string;
  templateVersion: number;
  status: "pending" | "processing" | "sent" | "delivered" | "failed" | "cancelled";
  approvalStatus: string;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  hasProviderMessage: boolean;
  relatedType: string | null;
  relatedId: string | null;
  scheduledAt: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  data: NotificationView[];
  meta: { hasMore: boolean; nextCursor: string | null };
}

interface ProblemDetails {
  title?: string;
  detail?: string;
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

export async function fetchLineChannels(organizationId: string): Promise<LineChannelView[]> {
  const response = await fetch(
    `/api/v2/organizations/${encodeURIComponent(organizationId)}/line-channels`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  const envelope = await readJson<{ data: LineChannelView[] }>(response);
  return envelope.data;
}

export async function connectLineChannel(
  organizationId: string,
  input: ConnectLineChannelInput,
): Promise<{ id: string; status: string; credentialConfigured: boolean }> {
  const response = await fetch(
    `/api/v2/organizations/${encodeURIComponent(organizationId)}/line-channels`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": createIdempotencyKey(),
        "X-CSRF-Token": ensureCsrfToken(),
      },
      body: JSON.stringify(input),
    },
  );
  const envelope = await readJson<{ data: { id: string; status: string; credentialConfigured: boolean } }>(
    response,
  );
  return envelope.data;
}

export async function disableLineChannel(
  organizationId: string,
  channelId: string,
  reason?: string,
): Promise<void> {
  const response = await fetch(
    `/api/v2/organizations/${encodeURIComponent(organizationId)}/line-channels/${encodeURIComponent(channelId)}/actions/disable`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": createIdempotencyKey(),
        "X-CSRF-Token": ensureCsrfToken(),
      },
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
  await readJson<unknown>(response);
}

export async function fetchNotifications(
  organizationId: string,
  options: { status?: string; cursor?: string | null; pageSize?: number } = {},
): Promise<NotificationPage> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.cursor) params.set("cursor", options.cursor);
  params.set("pageSize", String(options.pageSize ?? 20));

  const response = await fetch(
    `/api/v2/organizations/${encodeURIComponent(organizationId)}/notifications?${params.toString()}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  return readJson<NotificationPage>(response);
}

export async function retryNotification(
  organizationId: string,
  notificationId: string,
): Promise<void> {
  const response = await fetch(
    `/api/v2/organizations/${encodeURIComponent(organizationId)}/notifications/${encodeURIComponent(notificationId)}/actions/retry`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Idempotency-Key": createIdempotencyKey(),
        "X-CSRF-Token": ensureCsrfToken(),
      },
    },
  );
  await readJson<unknown>(response);
}

export async function cancelNotification(
  organizationId: string,
  notificationId: string,
): Promise<void> {
  const response = await fetch(
    `/api/v2/organizations/${encodeURIComponent(organizationId)}/notifications/${encodeURIComponent(notificationId)}/actions/cancel`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Idempotency-Key": createIdempotencyKey(),
        "X-CSRF-Token": ensureCsrfToken(),
      },
    },
  );
  await readJson<unknown>(response);
}
