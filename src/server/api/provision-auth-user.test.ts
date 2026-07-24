import { describe, expect, it, vi } from "vitest";

import { ApiProblem } from "./problem";
import { provisionAuthUserId } from "./provision-auth-user";

function adminStub(overrides: {
  createUser?: ReturnType<typeof vi.fn>;
  listUsers?: ReturnType<typeof vi.fn>;
}) {
  return {
    auth: {
      admin: {
        createUser: overrides.createUser ?? vi.fn(),
        listUsers: overrides.listUsers ?? vi.fn(),
      },
    },
    // The helper only touches `auth`; cast keeps the stub minimal.
  } as unknown as Parameters<typeof provisionAuthUserId>[0];
}

const NEW_ID = "10000000-0000-4000-8000-0000000000a1";

describe("provisionAuthUserId", () => {
  it("creates a confirmed auth user and returns its id", async () => {
    const createUser = vi.fn(async () => ({ data: { user: { id: NEW_ID } }, error: null }));
    const admin = adminStub({ createUser });

    const id = await provisionAuthUserId(admin, "  Invitee@Example.Test  ");

    expect(id).toBe(NEW_ID);
    expect(createUser).toHaveBeenCalledWith({
      email: "invitee@example.test",
      email_confirm: true,
    });
  });

  it("reuses an existing account by looking it up on email_exists", async () => {
    const createUser = vi.fn(async () => ({
      data: { user: null },
      error: { code: "email_exists", status: 422, message: "exists" },
    }));
    const listUsers = vi.fn(async () => ({
      data: {
        users: [
          { id: "other", email: "someone@example.test" },
          { id: NEW_ID, email: "Invitee@Example.test" },
        ],
      },
      error: null,
    }));
    const admin = adminStub({ createUser, listUsers });

    const id = await provisionAuthUserId(admin, "invitee@example.test");

    expect(id).toBe(NEW_ID);
  });

  it("fails cleanly when a duplicate cannot be found in the directory", async () => {
    const createUser = vi.fn(async () => ({
      data: { user: null },
      error: { code: "email_exists", status: 422, message: "exists" },
    }));
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));
    const admin = adminStub({ createUser, listUsers });

    await expect(provisionAuthUserId(admin, "invitee@example.test")).rejects.toMatchObject({
      status: 502,
    });
    expect(listUsers).toHaveBeenCalled();
  });

  it("surfaces an unexpected admin-create failure as a clean 5xx problem", async () => {
    const createUser = vi.fn(async () => ({
      data: { user: null },
      error: { code: "unexpected_failure", status: 500, message: "boom" },
    }));
    const admin = adminStub({ createUser });

    const error = await provisionAuthUserId(admin, "invitee@example.test").catch((e) => e);

    expect(error).toBeInstanceOf(ApiProblem);
    expect((error as ApiProblem).status).toBe(502);
  });
});
