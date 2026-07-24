import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  computeWorkMediaActuals: vi.fn(),
  signWorkMediaReadUrl: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/server/api/work-order-photos", () => ({
  computeWorkMediaActuals: mocks.computeWorkMediaActuals,
  signWorkMediaReadUrl: mocks.signWorkMediaReadUrl,
}));

import { POST } from "./route";

const ORG = "20000000-0000-4000-8000-000000000001";
const PHOTO = "90000000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function request(): Request {
  return new Request(
    `http://localhost/api/v2/organizations/${ORG}/photos/${PHOTO}/complete`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: `renoly-csrf=${csrf}`,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({}),
    },
  );
}

describe("photo complete route (verify-and-mark-ready)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mocks.computeWorkMediaActuals.mockResolvedValue({
      mimeType: "image/jpeg",
      byteSize: 1000,
      sha256: "a".repeat(64),
      width: 800,
      height: 600,
    });
  });

  it("resolves the storage path, verifies bytes, and flips to ready", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { photoId: PHOTO, storagePath: "org/x/work-orders/w/p/upload", mimeType: "image/jpeg", expiresInSeconds: 300 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { photoId: PHOTO, status: "ready", category: "before", byteSize: 1000, width: 800, height: 600, readyAt: "2026-08-01T05:00:00+00:00", lockVersion: 2 },
        error: null,
      });

    const response = await POST(request(), {
      params: Promise.resolve({ orgId: ORG, photoId: PHOTO }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("ready");
    expect(mocks.computeWorkMediaActuals).toHaveBeenCalledWith("org/x/work-orders/w/p/upload");
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "complete_work_order_photo", expect.objectContaining({
      p_actual_sha256: "a".repeat(64),
      p_image_width: 800,
    }));
  });

  it("maps a verification mismatch (42501) to a 403", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { photoId: PHOTO, storagePath: "org/x/work-orders/w/p/upload" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "PHOTO_VERIFICATION_MISMATCH" },
      });
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: ORG, photoId: PHOTO }),
    });
    expect(response.status).toBe(403);
  });

  it("rejects an unauthorized caller (FORBIDDEN on the authz RPC)", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "FORBIDDEN" } });
    const response = await POST(request(), {
      params: Promise.resolve({ orgId: ORG, photoId: PHOTO }),
    });
    expect(response.status).toBe(403);
    expect(mocks.computeWorkMediaActuals).not.toHaveBeenCalled();
  });
});
