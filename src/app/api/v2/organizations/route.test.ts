import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: supabaseMocks.createSupabaseServerClient,
}));

import { POST } from "./route";

const validInput = {
  name: "北城工程",
  slug: "north-city-service",
  industryTemplate: "general_field_service",
  timezone: "Asia/Taipei",
  currency: "TWD",
  ownerDisplayName: "王老闆",
};

const rpcResult = {
  organization: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "北城工程",
    slug: "north-city-service",
    industryTemplate: "general_field_service",
    timezone: "Asia/Taipei",
    currency: "TWD",
  },
  membership: {
    id: "22222222-2222-4222-8222-222222222222",
    organizationId: "11111111-1111-4111-8111-111111111111",
    role: "owner",
    status: "active",
    displayName: "王老闆",
  },
};

const CSRF_TOKEN = "csrf-token-value-0123456789-abcdefghij";

function createRequest(body: unknown = validInput, extraHeaders: Record<string, string> = {}): Request {
  return new Request("https://app.renoly.test/api/v2/organizations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-host": "attacker.example",
      "x-request-id": "67427c45-e326-4a0a-b7b7-82cf53999df7",
      origin: "https://app.renoly.test",
      "x-csrf-token": CSRF_TOKEN,
      cookie: `renoly-csrf=${CSRF_TOKEN}`,
      "idempotency-key": "org-create-idempotency-key",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v2/organizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: supabaseMocks.getUser },
      rpc: supabaseMocks.rpc,
    });
    supabaseMocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          email: "owner@example.com",
          app_metadata: { provider: "email", access_token: "never-return-me" },
        },
      },
      error: null,
    });
    supabaseMocks.rpc.mockResolvedValue({ data: rpcResult, error: null });
  });

  it("rejects a cross-origin request with a 403 before any auth or RPC call", async () => {
    const response = await POST(
      createRequest(validInput, { origin: "https://evil.example" }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("CSRF_INVALID");
    expect(supabaseMocks.getUser).not.toHaveBeenCalled();
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a request whose CSRF header does not match the cookie", async () => {
    const response = await POST(
      createRequest(validInput, { "x-csrf-token": "mismatched-token-value-abcdefghij-000" }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("CSRF_INVALID");
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key header on the mutation", async () => {
    const request = new Request("https://app.renoly.test/api/v2/organizations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.renoly.test",
        "x-csrf-token": CSRF_TOKEN,
        cookie: `renoly-csrf=${CSRF_TOKEN}`,
      },
      body: JSON.stringify(validInput),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a verified Supabase user before calling the organization RPC", async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect((await response.json()).code).toBe("AUTHENTICATION_REQUIRED");
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid and unknown fields before calling the RPC", async () => {
    const response = await POST(
      createRequest({ ...validInput, slug: "Bad Slug", admin: true }),
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.errors).toEqual(expect.any(Array));
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("creates the organization atomically and only returns the public token in its one-time URL", async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBe(
      "/api/v2/organizations/11111111-1111-4111-8111-111111111111",
    );
    const body = await response.json();
    expect(body.data.organization).toEqual(rpcResult.organization);
    expect(body.data.membership).toEqual(rpcResult.membership);
    expect(body.data.publicIntakeUrl).toMatch(
      /^https:\/\/app\.renoly\.test\/request\/[A-Za-z0-9_-]{43}$/,
    );
    expect(JSON.stringify(body)).not.toContain("never-return-me");
    expect(JSON.stringify(body)).not.toContain("access_token");
    expect(body.data.publicIntakeUrl).not.toContain("attacker.example");

    const rawToken = body.data.publicIntakeUrl.split("/").at(-1);
    const expectedHash = createHash("sha256")
      .update(rawToken, "utf8")
      .digest("hex");
    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      "create_pilot_organization",
      {
        p_name: validInput.name,
        p_slug: validInput.slug,
        p_industry_template: validInput.industryTemplate,
        p_timezone: validInput.timezone,
        p_currency: validInput.currency,
        p_owner_display_name: validInput.ownerDisplayName,
        p_public_intake_token_hash_hex: expectedHash,
        p_idempotency_key: "org-create-idempotency-key",
      },
    );
    expect(JSON.stringify(body)).not.toContain(expectedHash);
  });

  it("maps the organization slug unique constraint to a sanitized conflict", async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "organizations_slug_lower_uidx"',
        details: "Key (slug)=(north-city-service) already exists.",
      },
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("SLUG_TAKEN");
    expect(JSON.stringify(body)).not.toContain("organizations_slug_lower_uidx");
    expect(JSON.stringify(body)).not.toContain("Key (slug)");
  });

  it("maps the RPC's re-raised unique violation to a sanitized slug conflict", async () => {
    // create_pilot_organization catches unique_violation and re-raises it as
    // PILOT_ORGANIZATION_CONFLICT — this is the message the database actually
    // emits for a duplicate slug in production.
    supabaseMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "PILOT_ORGANIZATION_CONFLICT" },
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("SLUG_TAKEN");
    expect(JSON.stringify(body)).not.toContain("PILOT_ORGANIZATION_CONFLICT");
  });

  it("does not expose unexpected database failures", async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "secret internal database detail" },
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret internal database detail");
  });
});
