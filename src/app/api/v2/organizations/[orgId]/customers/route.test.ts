import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc, createSupabaseServerClient, authorize } = vi.hoisted(() => {
  const rpc = vi.fn();
  return {
    rpc,
    createSupabaseServerClient: vi.fn(async () => ({ rpc })),
    authorize: vi.fn(async () => ({ userId: "u1" })),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("@/server/api/org-authorization", () => ({ authorizeOrgManager: authorize }));

import { GET, POST } from "./route";

const orgId = "20000000-0000-4000-8000-000000000001";

function dbRow() {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    customer_no: "C-2026-0001",
    kind: "individual",
    name: "示範客戶甲",
    phone: "+886912345678",
    email: null,
    company_name: null,
    source: "manual",
    notes: "",
    last_contact_at: null,
    lock_version: 1,
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };
}

const params = { params: Promise.resolve({ orgId }) };

describe("GET .../customers", () => {
  afterEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ userId: "u1" });
  });

  it("returns customers projected by the authenticated RPC", async () => {
    rpc.mockResolvedValueOnce({ data: [dbRow()], error: null });

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].customerNo).toBe("C-2026-0001");
    expect(JSON.stringify(body)).not.toMatch(/deleted_at|organization/i);
    expect(rpc).toHaveBeenCalledWith("list_pilot_customers", {
      p_organization_id: orgId,
      p_query: null,
      p_limit: 20,
    });
  });

  it("passes search text to the literal-search RPC without building PostgREST filters", async () => {
    rpc.mockResolvedValueOnce({ data: [dbRow()], error: null });

    await GET(new Request("https://renoly.test/x?q=%25inject"), params);
    expect(rpc).toHaveBeenCalledWith("list_pilot_customers", {
      p_organization_id: orgId,
      p_query: "%inject",
      p_limit: 20,
    });
  });

  it("rejects an out-of-range limit before reaching the database", async () => {
    const response = await GET(new Request("https://renoly.test/x?limit=500"), params);
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("propagates a 403 from the authorization gate", async () => {
    const { ApiProblem } = await import("@/server/api/problem");
    authorize.mockRejectedValueOnce(
      new ApiProblem({ status: 403, code: "FORBIDDEN", title: "x", detail: "y" }),
    );

    const response = await GET(new Request("https://renoly.test/x"), params);
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

  it("maps a FORBIDDEN list RPC error to 403", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "FORBIDDEN" } });

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("FORBIDDEN");
  });

  it("returns 500 when a list row fails the customer DTO contract", async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: "not-a-uuid" }], error: null });

    const response = await GET(new Request("https://renoly.test/x"), params);
    expect(response.status).toBe(500);
  });
});

describe("POST .../customers", () => {
  afterEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ userId: "u1" });
  });

  it("creates a real customer through the authenticated transaction RPC", async () => {
    rpc.mockResolvedValueOnce({ data: dbRow(), error: null });

    const response = await POST(
      new Request("https://renoly.test/api/v2/organizations/x/customers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://renoly.test",
          cookie: "renoly-csrf=0123456789abcdef0123456789abcdef",
          "x-csrf-token": "0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({ name: "  示範客戶甲  ", phone: "+886912345678" }),
      }),
      params,
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBeNull();
    expect((await response.json()).data).toMatchObject({
      id: dbRow().id,
      customerNo: "C-2026-0001",
      name: "示範客戶甲",
    });
    expect(rpc).toHaveBeenCalledWith("create_pilot_customer", {
      p_organization_id: orgId,
      p_name: "示範客戶甲",
      p_phone: "+886912345678",
    });
  });

  it("rejects invalid input before reaching the database", async () => {
    const response = await POST(
      new Request("https://renoly.test/api/v2/organizations/x/customers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://renoly.test",
          cookie: "renoly-csrf=0123456789abcdef0123456789abcdef",
          "x-csrf-token": "0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({ name: "", phone: "0912345678" }),
      }),
      params,
    );

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin create before authorizing or writing", async () => {
    const response = await POST(
      new Request("https://renoly.test/api/v2/organizations/x/customers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          cookie: "renoly-csrf=0123456789abcdef0123456789abcdef",
          "x-csrf-token": "0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({ name: "示範客戶甲", phone: "+886912345678" }),
      }),
      params,
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("CSRF_INVALID");
    expect(authorize).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a cross-tenant create RPC error to a non-leaky 403", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "FORBIDDEN" } });

    const response = await POST(
      new Request("https://renoly.test/api/v2/organizations/x/customers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://renoly.test",
          cookie: "renoly-csrf=0123456789abcdef0123456789abcdef",
          "x-csrf-token": "0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({ name: "示範客戶甲", phone: "+886912345678" }),
      }),
      params,
    );

    expect(response.status).toBe(403);
  });

  it("returns 500 when the created row fails the customer DTO contract", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "not-a-uuid" }, error: null });

    const response = await POST(
      new Request("https://renoly.test/api/v2/organizations/x/customers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://renoly.test",
          cookie: "renoly-csrf=0123456789abcdef0123456789abcdef",
          "x-csrf-token": "0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({ name: "示範客戶甲", phone: "+886912345678" }),
      }),
      params,
    );

    expect(response.status).toBe(500);
  });
});
