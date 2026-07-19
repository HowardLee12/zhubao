import type {
  CreateQuoteInput,
  PublicDecisionRecord,
  PublicQuote,
  PublicQuoteResponse,
  QuoteDraftInput,
  QuoteWorkspace,
} from "@/schemas/quote";

import { ensureCsrfToken, PilotApiError } from "./api";

const JSON_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
} as const;

interface ProblemDetails {
  title?: string;
  detail?: string;
  code?: string;
}

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as { data: T } | ProblemDetails | null;
  if (!response.ok) {
    const problem = body as ProblemDetails | null;
    throw new PilotApiError(
      problem?.detail ?? problem?.title ?? "服務暫時無法使用，請稍後再試。",
      response.status,
    );
  }
  return (body as { data: T }).data;
}

function orgPath(organizationId: string): string {
  return `/api/v2/organizations/${encodeURIComponent(organizationId)}`;
}

function mutationHeaders(lockVersion: number, idempotencyKey?: string) {
  return {
    ...JSON_HEADERS,
    "If-Match": `"${lockVersion}"`,
    "X-CSRF-Token": ensureCsrfToken(),
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

export async function fetchQuoteWorkspace(
  organizationId: string,
  quoteId: string,
): Promise<QuoteWorkspace> {
  const response = await fetch(
    `${orgPath(organizationId)}/quotes/${encodeURIComponent(quoteId)}`,
    { headers: { Accept: "application/json" } },
  );
  return readData<QuoteWorkspace>(response);
}

export async function fetchQuoteWorkspaceForRequest(
  organizationId: string,
  requestId: string,
): Promise<QuoteWorkspace | null> {
  const response = await fetch(
    `${orgPath(organizationId)}/service-requests/${encodeURIComponent(requestId)}/quote`,
    { headers: { Accept: "application/json" } },
  );
  if (response.status === 404) return null;
  return readData<QuoteWorkspace>(response);
}

export async function createQuote(
  organizationId: string,
  requestLockVersion: number,
  idempotencyKey: string,
  input: CreateQuoteInput,
): Promise<QuoteWorkspace> {
  const response = await fetch(`${orgPath(organizationId)}/quotes`, {
    method: "POST",
    headers: mutationHeaders(requestLockVersion, idempotencyKey),
    body: JSON.stringify(input),
  });
  return readData<QuoteWorkspace>(response);
}

export async function saveQuoteDraft(
  organizationId: string,
  versionId: string,
  quoteLockVersion: number,
  input: QuoteDraftInput,
): Promise<QuoteWorkspace> {
  const response = await fetch(
    `${orgPath(organizationId)}/quote-versions/${encodeURIComponent(versionId)}`,
    {
      method: "PATCH",
      headers: mutationHeaders(quoteLockVersion),
      body: JSON.stringify(input),
    },
  );
  return readData<QuoteWorkspace>(response);
}

export interface QuoteLinkResult extends QuoteWorkspace {
  publicQuoteUrl: string;
}

export async function sendQuote(
  organizationId: string,
  workspace: QuoteWorkspace,
  idempotencyKey: string,
): Promise<QuoteLinkResult> {
  const response = await fetch(
    `${orgPath(organizationId)}/quotes/${encodeURIComponent(workspace.quote.id)}/actions/send`,
    {
      method: "POST",
      headers: mutationHeaders(workspace.quote.lockVersion, idempotencyKey),
      body: JSON.stringify({
        versionId: workspace.version.id,
        serviceRequestLockVersion: workspace.request.lockVersion,
      }),
    },
  );
  return readData<QuoteLinkResult>(response);
}

export async function rotateQuotePublicLink(
  organizationId: string,
  workspace: QuoteWorkspace,
  idempotencyKey: string,
): Promise<QuoteLinkResult> {
  const response = await fetch(
    `${orgPath(organizationId)}/quotes/${encodeURIComponent(workspace.quote.id)}/actions/rotate-public-link`,
    {
      method: "POST",
      headers: mutationHeaders(workspace.quote.lockVersion, idempotencyKey),
      body: "{}",
    },
  );
  return readData<QuoteLinkResult>(response);
}

export async function cloneRejectedQuote(
  organizationId: string,
  workspace: QuoteWorkspace,
  idempotencyKey: string,
): Promise<QuoteWorkspace> {
  const response = await fetch(
    `${orgPath(organizationId)}/quotes/${encodeURIComponent(workspace.quote.id)}/versions`,
    {
      method: "POST",
      headers: mutationHeaders(workspace.quote.lockVersion, idempotencyKey),
      body: JSON.stringify({ cloneFromVersionId: workspace.version.id }),
    },
  );
  return readData<QuoteWorkspace>(response);
}

export async function fetchPublicQuote(token: string): Promise<PublicQuote> {
  const response = await fetch("/api/v2/public/quotes/current", {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  return readData<PublicQuote>(response);
}

export async function respondPublicQuote(
  token: string,
  idempotencyKey: string,
  input: PublicQuoteResponse,
): Promise<PublicDecisionRecord> {
  const response = await fetch(
    "/api/v2/public/quotes/current/responses",
    {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
  );
  return readData<PublicDecisionRecord>(response);
}
