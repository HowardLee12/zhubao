import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc, getUser, createSupabaseServerClient, authorize, createAdmin, createUser, listUsers } =
  vi.hoisted(() => {
    const rpc = vi.fn();
    const getUser = vi.fn(
      async (): Promise<{ data: { user: { id: string } | null }; error: unknown }> => ({
        data: { user: { id: "u1" } },
        error: null,
      }),
    );
    const createUser = vi.fn();
    const listUsers = vi.fn();
    return {
      rpc,
      getUser,
      createUser,
      listUsers,
      createSupabaseServerClient: vi.fn(async () => ({ rpc, auth: { getUser } })),
      authorize: vi.fn(async () => ({ userId: "u1" })),
      createAdmin: vi.fn(() => ({ auth: { admin: { createUser, listUsers } } })),
    };
  });

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/server/api/org-authorization", () => ({ authorizeOrgManager: authorize }));
vi.mock("@/server/supabase/admin", () => ({ createAdminSupabaseClient: createAdmin }));

import { GET, POST } from "./route";

const orgId = "20000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ orgId }) };

const invitedUserId = "10000000-0000-4000-8000-0000000000a1";
const memberId = "30000000-0000-4000-8000-0000000000a1";

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: memberId,
    display_name: "新進技師",
    role: "technician",
    status: "active",
    ...overrides,
  };
}

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://renoly.test/api/v2/organizations/x/members", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://renoly.test",
      cookie: "renoly-csrf=0123456789abcdef0123456789abcdef",
      "x-csrf-token": "0123456789abcdef0123456789abcdef",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const validInvite = { displayName: "  新進技師  ", email: "invitee@example.test", role: "technician" };

afterEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({ userId: "u1" });
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
});

describe("GET .../members", () => {
  it("returns the active assignment projection by default", async () => {
    rpc.mockResolvedValueOnce({ data: [memberRow()], error: null });

    const response = await GET(new Request("https://renoly.test/x"), params);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("list_pilot_assignable_members", {
      p_organization_id: orgId,
    });
  });

  it("returns the full roster when scope=all", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        memberRow({ status: "suspended" }),
        memberRow({ id: "30000000-0000-4000-8000-0000000000b2", role: "admin" }),
      ],
      error: null,
    });

    const response = await GET(new Request("https://renoly.test/x?scope=all"), params);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toEqual({
      id: memberId,
      displayName: "新進技師",
      role: "technician",
      status: "suspended",
    });
    expect(rpc).toHaveBeenCalledWith("list_pilot_members", { p_organization_id: orgId });
  });

  it("rejects an unknown scope before reaching the database", async () => {
    const response = await GET(new Request("https://renoly.test/x?scope=nope"), params);
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("propagates a 403 from the authorization gate", async () => {
    const { ApiProblem } = await import("@/server/api/problem");
    authorize.mockRejectedValueOnce(
      new ApiProblem({ status: 403, code: "FORBIDDEN", title: "x", detail: "y" }),
    );

    const response = await GET(new Request("https://renoly.test/x?scope=all"), params);
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed organization id before authorizing (422)", async () => {
    const response = await GET(new Request("https://renoly.test/x"), {
      params: Promise.resolve({ orgId: "not-a-uuid" }),
    });
    expect(response.status).toBe(422);
    expect(authorize).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a FORBIDDEN roster RPC error to 403", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "FORBIDDEN" } });

    const response = await GET(new Request("https://renoly.test/x?scope=all"), params);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("FORBIDDEN");
  });

  it("returns 500 when a roster row fails the member DTO contract", async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: "not-a-uuid", role: "wizard" }], error: null });

    const response = await GET(new Request("https://renoly.test/x?scope=all"), params);
    expect(response.status).toBe(500);
  });
});

describe("POST .../members", () => {
  it("provisions a fresh auth user then binds the membership", async () => {
    createUser.mockResolvedValueOnce({ data: { user: { id: invitedUserId } }, error: null });
    rpc.mockResolvedValueOnce({ data: memberRow(), error: null });

    const response = await POST(postRequest(validInvite), params);

    expect(response.status).toBe(201);
    expect((await response.json()).data).toEqual({
      id: memberId,
      displayName: "新進技師",
      role: "technician",
      status: "active",
    });
    expect(createUser).toHaveBeenCalledWith({
      email: "invitee@example.test",
      email_confirm: true,
    });
    expect(rpc).toHaveBeenCalledWith(
      "invite_pilot_member",
      expect.objectContaining({
        p_organization_id: orgId,
        p_user_id: invitedUserId,
        p_display_name: "新進技師",
        p_role: "technician",
        p_phone: null,
      }),
    );
  });

  it("reuses an existing auth user when the email already has an account", async () => {
    createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { code: "email_exists", status: 422, message: "exists" },
    });
    listUsers.mockResolvedValueOnce({
      data: { users: [{ id: invitedUserId, email: "invitee@example.test" }] },
      error: null,
    });
    rpc.mockResolvedValueOnce({ data: memberRow(), error: null });

    const response = await POST(postRequest(validInvite), params);

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(
      "invite_pilot_member",
      expect.objectContaining({ p_user_id: invitedUserId }),
    );
  });

  it("rejects an unauthenticated caller with 401 and never provisions", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const { authenticationRequiredProblem } = await import("@/server/supabase/http");
    authorize.mockRejectedValueOnce(authenticationRequiredProblem());

    const response = await POST(postRequest(validInvite), params);

    expect(response.status).toBe(401);
    expect(createUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a request that fails CSRF with 403", async () => {
    const response = await POST(
      postRequest(validInvite, { origin: "https://evil.test" }),
      params,
    );

    expect(response.status).toBe(403);
    expect(authorize).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("rejects a non-manager with 403", async () => {
    const { ApiProblem } = await import("@/server/api/problem");
    authorize.mockRejectedValueOnce(
      new ApiProblem({ status: 403, code: "FORBIDDEN", title: "x", detail: "y" }),
    );

    const response = await POST(postRequest(validInvite), params);

    expect(response.status).toBe(403);
    expect(createUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects role='owner' at the schema boundary with 422", async () => {
    const response = await POST(postRequest({ ...validInvite, role: "owner" }), params);

    expect(response.status).toBe(422);
    expect(createUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed email at the schema boundary with 422", async () => {
    const response = await POST(postRequest({ ...validInvite, email: "not-an-email" }), params);

    expect(response.status).toBe(422);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("maps a duplicate membership from the RPC to 409", async () => {
    createUser.mockResolvedValueOnce({ data: { user: { id: invitedUserId } }, error: null });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "MEMBERSHIP_ALREADY_EXISTS" },
    });

    const response = await POST(postRequest(validInvite), params);

    expect(response.status).toBe(409);
  });

  it("maps a cross-tenant / forbidden RPC error to 403", async () => {
    createUser.mockResolvedValueOnce({ data: { user: { id: invitedUserId } }, error: null });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "FORBIDDEN" },
    });

    const response = await POST(postRequest(validInvite), params);

    expect(response.status).toBe(403);
  });

  it("maps an admin-API failure to a clean 5xx without leaking the service key", async () => {
    createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { code: "unexpected_failure", status: 500, message: "boom" },
    });

    const response = await POST(postRequest(validInvite), params);

    expect(response.status).toBeGreaterThanOrEqual(500);
    const body = JSON.stringify(await response.json());
    expect(body).not.toMatch(/service|role|key|eyJ/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed organization id after CSRF but before provisioning (422)", async () => {
    const response = await POST(postRequest(validInvite), {
      params: Promise.resolve({ orgId: "not-a-uuid" }),
    });

    expect(response.status).toBe(422);
    expect(createUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 500 when the invite RPC row fails the member DTO contract", async () => {
    createUser.mockResolvedValueOnce({ data: { user: { id: invitedUserId } }, error: null });
    rpc.mockResolvedValueOnce({ data: { id: "not-a-uuid", role: "wizard" }, error: null });

    const response = await POST(postRequest(validInvite), params);

    expect(response.status).toBe(500);
  });
});
