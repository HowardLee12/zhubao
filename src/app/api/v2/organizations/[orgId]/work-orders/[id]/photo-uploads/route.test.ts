import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  signWorkMediaUploadUrl: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

vi.mock("@/server/api/work-order-photos", () => ({
  signWorkMediaUploadUrl: mocks.signWorkMediaUploadUrl,
}));

import { POST } from "./route";

const ORG = "20000000-0000-4000-8000-000000000001";
const WO = "82060000-0000-4000-8000-000000000001";
const PHOTO = "90000000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

const validBody = {
  category: "before",
  filename: "unit.jpg",
  contentType: "image/jpeg",
  byteSize: 2048,
  sha256: "a".repeat(64),
};

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(
    `http://localhost/api/v2/organizations/${ORG}/work-orders/${WO}/photo-uploads`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: `renoly-csrf=${csrf}`,
        "x-csrf-token": csrf,
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

const params = { params: Promise.resolve({ orgId: ORG, id: WO }) };

describe("work-order photo-uploads route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mocks.signWorkMediaUploadUrl.mockResolvedValue({
      method: "PUT",
      url: "https://signed.example/put",
      headers: { "x-upsert": "false" },
      expiresAt: "2026-08-01T00:10:00.000Z",
    });
  });

  it("reserves a pending row and returns a signed upload envelope", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        photoId: PHOTO,
        storagePath: "org/x/work-orders/w/p/upload",
        status: "pending",
        uploadExpiresInSeconds: 600,
      },
      error: null,
    });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.photoId).toBe(PHOTO);
    expect(body.data.upload.url).toBe("https://signed.example/put");
    expect(mocks.signWorkMediaUploadUrl).toHaveBeenCalledWith("org/x/work-orders/w/p/upload");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_photo_upload",
      expect.objectContaining({
        target_org: ORG,
        parent_type: "work_order",
        parent_id: WO,
        photo_category: "before",
        declared_mime_type: "image/jpeg",
        declared_byte_size: 2048,
      }),
    );
  });

  it("requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails CSRF when the double-submit token is missing", async () => {
    const response = await POST(postRequest(validBody, { "x-csrf-token": "", cookie: "" }), params);

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an unsupported content type with a 422", async () => {
    const response = await POST(postRequest({ ...validBody, contentType: "image/gif" }), params);

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed work-order id", async () => {
    const response = await POST(postRequest(validBody), {
      params: Promise.resolve({ orgId: ORG, id: "x" }),
    });

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a not-uploadable RPC error to 409", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "WORK_ORDER_NOT_UPLOADABLE" },
    });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(409);
    expect(mocks.signWorkMediaUploadUrl).not.toHaveBeenCalled();
  });

  it("returns 500 when the reservation payload fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { photoId: PHOTO }, error: null });

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(500);
    expect(mocks.signWorkMediaUploadUrl).not.toHaveBeenCalled();
  });

  it("surfaces a signer failure as its own problem status", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        photoId: PHOTO,
        storagePath: "org/x/work-orders/w/p/upload",
        status: "pending",
        uploadExpiresInSeconds: 600,
      },
      error: null,
    });
    const { ApiProblem } = await import("@/server/api/problem");
    mocks.signWorkMediaUploadUrl.mockRejectedValue(
      new ApiProblem({ status: 500, code: "INTERNAL_ERROR", title: "x", detail: "y" }),
    );

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(500);
  });

  it("collapses an unexpected non-problem error into a 500", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(new Error("boom"));

    const response = await POST(postRequest(validBody), params);

    expect(response.status).toBe(500);
  });
});
