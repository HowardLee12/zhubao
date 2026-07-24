import { describe, expect, it, vi } from "vitest";

import { authorizeOrgManager } from "./org-authorization";

const orgId = "20000000-0000-4000-8000-000000000001";

function client(user: unknown, roleResult: { data?: unknown; error?: unknown }) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: user ? null : { message: "no" } })) },
    rpc: vi.fn(async () => ({ data: roleResult.data ?? null, error: roleResult.error ?? null })),
  } as never;
}

describe("authorizeOrgManager", () => {
  it("returns the user id for a manager", async () => {
    const result = await authorizeOrgManager(client({ id: "u1" }, { data: true }), orgId);
    expect(result.userId).toBe("u1");
  });

  it("throws 401 when unauthenticated", async () => {
    await expect(authorizeOrgManager(client(null, { data: true }), orgId)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("throws 403 when has_org_role is false (technician / non-member)", async () => {
    await expect(
      authorizeOrgManager(client({ id: "u1" }, { data: false }), orgId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("throws 403 when the role check errors", async () => {
    await expect(
      authorizeOrgManager(client({ id: "u1" }, { error: { message: "boom" } }), orgId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("calls has_org_role with the manager role set", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const c = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null })) },
      rpc,
    } as never;
    await authorizeOrgManager(c, orgId);
    expect(rpc).toHaveBeenCalledWith("has_org_role", {
      target_org: orgId,
      allowed_roles: ["owner", "admin", "dispatcher"],
    });
  });
});
