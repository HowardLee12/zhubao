import { afterEach, describe, expect, it, vi } from "vitest";

const { getUser, rpc, createSupabaseServerClient } = vi.hoisted(() => {
  const getUser = vi.fn();
  const rpc = vi.fn();
  return {
    getUser,
    rpc,
    createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser }, rpc })),
  };
});

vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient }));

import { GET, PATCH } from "./route";

const orgId = "2f66bf0a-b8d9-4722-9e2a-23f218f25d86";
const settings = {
  organizationId: orgId,
  name: "北城工程",
  industryTemplate: "general_field_service",
  intakeHeadline: "描述需求，我們確認後聯絡您",
  privacyNotice: "資料僅供本次服務聯繫使用。",
  lockVersion: 1,
};

const CSRF_TOKEN = "settings-csrf-token-0123456789-abcdefgh";

function patchRequest(input: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request(`https://renoly.test/api/v2/organizations/${orgId}/settings`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "https://renoly.test",
      "x-csrf-token": CSRF_TOKEN,
      cookie: `renoly-csrf=${CSRF_TOKEN}`,
      ...extraHeaders,
    },
    body: JSON.stringify(input),
  });
}

describe("pilot organization settings route", () => {
  afterEach(() => vi.clearAllMocks());

  it("reads settings through the authenticated scoped RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: settings, error: null });

    const response = await GET(
      new Request(`https://renoly.test/api/v2/organizations/${orgId}/settings`),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: settings });
    expect(rpc).toHaveBeenCalledWith("get_pilot_organization_settings", {
      p_organization_id: orgId,
    });
  });

  it("updates only allowlisted settings with an expected lock version", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: { ...settings, lockVersion: 2 }, error: null });

    const input = {
      name: "北城到府工程",
      intakeHeadline: settings.intakeHeadline,
      privacyNotice: settings.privacyNotice,
      lockVersion: 1,
    };
    const response = await PATCH(patchRequest(input), { params: Promise.resolve({ orgId }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_pilot_organization_settings", {
      p_organization_id: orgId,
      p_settings_patch: {
        name: input.name,
        intakeHeadline: input.intakeHeadline,
        privacyNotice: input.privacyNotice,
      },
      p_expected_lock_version: 1,
    });
  });

  it("rejects a cross-origin settings update with a 403 before the RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await PATCH(
      patchRequest(
        {
          name: "北城到府工程",
          intakeHeadline: settings.intakeHeadline,
          privacyNotice: settings.privacyNotice,
          lockVersion: 1,
        },
        { origin: "https://evil.example" },
      ),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("CSRF_INVALID");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated reads before the RPC", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });

    const response = await GET(
      new Request(`https://renoly.test/api/v2/organizations/${orgId}/settings`),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed organization id before the RPC (422)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await GET(new Request("https://renoly.test/x"), {
      params: Promise.resolve({ orgId: "not-a-uuid" }),
    });

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a FORBIDDEN RPC error on read to 403", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN: not a manager" } });

    const response = await GET(new Request("https://renoly.test/x"), {
      params: Promise.resolve({ orgId }),
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("FORBIDDEN");
  });

  it("maps an AUTH_REQUIRED RPC error on read to 401", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { details: "AUTH_REQUIRED" } });

    const response = await GET(new Request("https://renoly.test/x"), {
      params: Promise.resolve({ orgId }),
    });

    expect(response.status).toBe(401);
  });

  it("maps a STALE_VERSION RPC error on update to 409", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: "STALE_VERSION" } });

    const response = await PATCH(
      patchRequest({
        name: "北城到府工程",
        intakeHeadline: settings.intakeHeadline,
        privacyNotice: settings.privacyNotice,
        lockVersion: 1,
      }),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("STALE_VERSION");
  });

  it("maps an unrecognized RPC error to a non-leaky 500", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: "boom", details: "pg internal" } });

    const response = await GET(new Request("https://renoly.test/x"), {
      params: Promise.resolve({ orgId }),
    });

    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).not.toMatch(/pg internal/);
  });

  it("returns 500 when the RPC row fails the DTO contract on read", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: { organizationId: orgId, name: "" }, error: null });

    const response = await GET(new Request("https://renoly.test/x"), {
      params: Promise.resolve({ orgId }),
    });

    expect(response.status).toBe(500);
  });

  it("returns 500 when the update RPC row fails the DTO contract", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });
    rpc.mockResolvedValue({ data: { lockVersion: "not-a-number" }, error: null });

    const response = await PATCH(
      patchRequest({
        name: "北城到府工程",
        intakeHeadline: settings.intakeHeadline,
        privacyNotice: settings.privacyNotice,
        lockVersion: 1,
      }),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(500);
  });

  it("rejects an invalid update payload before the RPC (422)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } }, error: null });

    const response = await PATCH(
      patchRequest({ name: "", intakeHeadline: "", privacyNotice: "", lockVersion: 0 }),
      { params: Promise.resolve({ orgId }) },
    );

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});
