import { afterEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc, createSupabaseServerClient, verifyCsrf } = vi.hoisted(() => {
  const getUser = vi.fn();
  const rpc = vi.fn();
  return {
    getUser,
    rpc,
    createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser }, rpc })),
    verifyCsrf: vi.fn(),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/server/api/csrf", () => ({
  verifyCsrf,
  configuredAppOrigin: () => "https://renoly.test",
}));

import { POST } from "./route";

const orgId = "2f66bf0a-b8d9-4722-9e2a-23f218f25d86";
const id = "d0000000-0000-4000-8000-000000000001";

function envelope(replayed: boolean) {
  return {
    serviceRequestId: "80000000-0000-4000-8000-000000000001",
    requestNo: "SR-202607-000001",
    draftId: id,
    draftStatus: "confirmed",
    status: "new",
    replayed,
  };
}

function makeRequest(body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(
    `https://renoly.test/api/v2/organizations/${orgId}/intake-drafts/${id}/actions/confirm`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": '"2"',
        "idempotency-key": "confirm-abc-123456",
        origin: "https://renoly.test",
        "x-csrf-token": "x".repeat(43),
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

function contextFor(rawOrg: string = orgId, rawId: string = id) {
  return { params: Promise.resolve({ orgId: rawOrg, id: rawId }) };
}

function authed() {
  getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
}

describe("POST .../intake-drafts/:id/actions/confirm", () => {
  afterEach(() => {
    vi.clearAllMocks();
    verifyCsrf.mockReset();
  });

  it("confirms a draft and returns 201 with the service-request envelope", async () => {
    authed();
    rpc.mockResolvedValue({ data: envelope(false), error: null });

    const response = await POST(makeRequest(), contextFor());

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.serviceRequestId).toBe("80000000-0000-4000-8000-000000000001");
    expect(body.data.draftStatus).toBe("confirmed");
    expect(rpc).toHaveBeenCalledWith("confirm_intake_draft", {
      target_org: orgId,
      target_draft: id,
      expected_lock_version: 2,
      target_idempotency_key: "confirm-abc-123456",
      p_field_overrides: null,
    });
  });

  it("passes reviewer field overrides through to the RPC", async () => {
    authed();
    rpc.mockResolvedValue({ data: envelope(false), error: null });

    await POST(
      makeRequest({
        fieldOverrides: { subject: { value: "冷氣清洗", source: "manual", confidence: 1 } },
      }),
      contextFor(),
    );

    expect(rpc).toHaveBeenCalledWith(
      "confirm_intake_draft",
      expect.objectContaining({
        p_field_overrides: { subject: { value: "冷氣清洗", source: "manual", confidence: 1 } },
      }),
    );
  });

  it("returns 200 (not 201) on an idempotent replay envelope", async () => {
    authed();
    rpc.mockResolvedValue({ data: envelope(true), error: null });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(200);
    expect((await response.json()).data.replayed).toBe(true);
  });

  it("fails CSRF (403) before touching the RPC", async () => {
    const { ApiProblem } = await import("@/server/api/problem");
    verifyCsrf.mockImplementation(() => {
      throw new ApiProblem({ status: 403, code: "CSRF_FAILED", title: "x", detail: "x" });
    });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 428 when If-Match is missing", async () => {
    const response = await POST(makeRequest({}, { "if-match": "" }), contextFor());
    expect(response.status).toBe(428);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 400 when Idempotency-Key is missing", async () => {
    const response = await POST(makeRequest({}, { "idempotency-key": "" }), contextFor());
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 422 for an invalid orgId path segment", async () => {
    const response = await POST(makeRequest(), contextFor("nope", id));
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 422 for an invalid draft id path segment", async () => {
    const response = await POST(makeRequest(), contextFor(orgId, "nope"));
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 422 for a body that fails the Zod schema (unknown key)", async () => {
    const response = await POST(makeRequest({ bogus: true }), contextFor());
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a session (401)", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a FORBIDDEN RPC error to 403", async () => {
    authed();
    rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN: role" } });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(403);
  });

  it("maps an INTAKE_DRAFT_NOT_FOUND RPC error to a non-leaky 404", async () => {
    authed();
    rpc.mockResolvedValue({ data: null, error: { message: "INTAKE_DRAFT_NOT_FOUND" } });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(404);
  });

  it("maps a STALE_VERSION RPC error to 412", async () => {
    authed();
    rpc.mockResolvedValue({ data: null, error: { message: "STALE_VERSION" } });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(412);
  });

  it("maps an INTAKE_DRAFT_NOT_CONFIRMABLE RPC error to 409", async () => {
    authed();
    rpc.mockResolvedValue({ data: null, error: { message: "INTAKE_DRAFT_NOT_CONFIRMABLE" } });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(409);
  });

  it("returns 500 when the RPC envelope is the wrong shape", async () => {
    authed();
    rpc.mockResolvedValue({ data: { unexpected: true }, error: null });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(500);
  });
});
