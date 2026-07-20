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
  return { draftId: id, draftStatus: "dismissed", replayed };
}

function makeRequest(body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(
    `https://renoly.test/api/v2/organizations/${orgId}/intake-drafts/${id}/actions/dismiss`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": '"2"',
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

describe("POST .../intake-drafts/:id/actions/dismiss", () => {
  afterEach(() => {
    vi.clearAllMocks();
    verifyCsrf.mockReset();
  });

  it("dismisses a draft and returns 200 with the dismiss envelope", async () => {
    authed();
    rpc.mockResolvedValue({ data: envelope(false), error: null });

    const response = await POST(makeRequest(), contextFor());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.draftStatus).toBe("dismissed");
    expect(body.data.replayed).toBe(false);
    // No reason supplied → the RPC gets an explicit null (not undefined).
    expect(rpc).toHaveBeenCalledWith("dismiss_intake_draft", {
      target_org: orgId,
      target_draft: id,
      expected_lock_version: 2,
      p_reason: null,
    });
  });

  it("passes a supplied reason through to the RPC", async () => {
    authed();
    rpc.mockResolvedValue({ data: envelope(false), error: null });

    await POST(makeRequest({ reason: "spam" }), contextFor());

    expect(rpc).toHaveBeenCalledWith(
      "dismiss_intake_draft",
      expect.objectContaining({ p_reason: "spam" }),
    );
  });

  it("returns replayed=true on an idempotent second dismiss", async () => {
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

  it("returns 422 for a reason that violates the Zod schema (too long)", async () => {
    const response = await POST(makeRequest({ reason: "x".repeat(501) }), contextFor());
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
    rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(403);
  });

  it("maps a STALE_VERSION RPC error to 412", async () => {
    authed();
    rpc.mockResolvedValue({ data: null, error: { message: "STALE_VERSION" } });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(412);
  });

  it("maps an INTAKE_DRAFT_NOT_DISMISSABLE RPC error to 409", async () => {
    authed();
    rpc.mockResolvedValue({ data: null, error: { message: "INTAKE_DRAFT_NOT_DISMISSABLE" } });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(409);
  });

  it("returns 500 when the RPC envelope is the wrong shape", async () => {
    authed();
    rpc.mockResolvedValue({ data: { draftStatus: "confirmed" }, error: null });

    const response = await POST(makeRequest(), contextFor());
    expect(response.status).toBe(500);
  });
});
