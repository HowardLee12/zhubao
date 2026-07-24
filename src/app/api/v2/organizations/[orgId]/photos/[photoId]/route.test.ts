import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  resolveWorkOrderPhotoReadUrl: vi.fn(),
}));

vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

vi.mock("@/server/work-orders/gateway", () => ({
  resolveWorkOrderPhotoReadUrl: mocks.resolveWorkOrderPhotoReadUrl,
}));

import { DELETE, GET, PATCH } from "./route";
import { ApiProblem } from "@/server/api/problem";

const ORG = "20000000-0000-4000-8000-000000000001";
const PHOTO = "90000000-0000-4000-8000-000000000001";
const csrf = "csrf-token-value-0123456789-abcdefghij";

function mutate(
  method: "PATCH" | "DELETE",
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost/api/v2/organizations/${ORG}/photos/${PHOTO}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: `renoly-csrf=${csrf}`,
      "x-csrf-token": csrf,
      "if-match": '"2"',
      ...headers,
    },
    body: method === "DELETE" && body === undefined ? undefined : JSON.stringify(body),
  });
}

function getRequest(): Request {
  return new Request(`http://localhost/api/v2/organizations/${ORG}/photos/${PHOTO}`);
}

const params = { params: Promise.resolve({ orgId: ORG, photoId: PHOTO }) };

describe("work-order photo detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({
      rpc: mocks.rpc,
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mocks.resolveWorkOrderPhotoReadUrl.mockResolvedValue({
      photoId: PHOTO,
      url: "https://signed.example/get",
      expiresAt: "2026-08-01T00:05:00.000Z",
    });
  });

  it("GET mints a signed read URL via the gateway", async () => {
    const response = await GET(getRequest(), params);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.url).toBe("https://signed.example/get");
    expect(mocks.resolveWorkOrderPhotoReadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, photoId: PHOTO }),
    );
  });

  it("GET requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(getRequest(), params);

    expect(response.status).toBe(401);
    expect(mocks.resolveWorkOrderPhotoReadUrl).not.toHaveBeenCalled();
  });

  it("GET rejects a malformed photo id", async () => {
    const response = await GET(getRequest(), {
      params: Promise.resolve({ orgId: ORG, photoId: "x" }),
    });

    expect(response.status).toBe(422);
    expect(mocks.resolveWorkOrderPhotoReadUrl).not.toHaveBeenCalled();
  });

  it("GET surfaces a gateway 404 problem as a non-leaky 404", async () => {
    mocks.resolveWorkOrderPhotoReadUrl.mockRejectedValue(
      new ApiProblem({ status: 404, code: "NOT_FOUND", title: "x", detail: "y" }),
    );

    const response = await GET(getRequest(), params);

    expect(response.status).toBe(404);
  });

  it("PATCH updates the caption and returns the new ETag", async () => {
    mocks.rpc.mockResolvedValue({
      data: { photoId: PHOTO, caption: "更新", category: "before", lockVersion: 3 },
      error: null,
    });

    const response = await PATCH(mutate("PATCH", { caption: "更新" }), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"3"');
    expect(mocks.rpc).toHaveBeenCalledWith(
      "update_work_order_photo",
      expect.objectContaining({
        target_org: ORG,
        target_photo: PHOTO,
        p_caption: "更新",
        p_category: null,
        p_expected_lock_version: 2,
      }),
    );
  });

  it("PATCH requires at least one field to update", async () => {
    const response = await PATCH(mutate("PATCH", {}), params);

    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("PATCH requires If-Match", async () => {
    const response = await PATCH(mutate("PATCH", { caption: "x" }, { "if-match": "" }), params);

    expect(response.status).toBe(428);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("PATCH fails CSRF without a token", async () => {
    const response = await PATCH(
      mutate("PATCH", { caption: "x" }, { "x-csrf-token": "", cookie: "" }),
      params,
    );

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("DELETE soft-deletes the photo", async () => {
    mocks.rpc.mockResolvedValue({ data: { photoId: PHOTO, status: "deleted" }, error: null });

    const response = await DELETE(mutate("DELETE", {}), params);

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "delete_work_order_photo",
      expect.objectContaining({
        target_org: ORG,
        target_photo: PHOTO,
        p_expected_lock_version: 2,
      }),
    );
  });

  it("DELETE requires authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await DELETE(mutate("DELETE", {}), params);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("DELETE maps a completion-evidence guard to 409", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "PHOTO_IS_COMPLETION_EVIDENCE" },
    });

    const response = await DELETE(mutate("DELETE", {}), params);

    expect(response.status).toBe(409);
  });

  it("DELETE requires If-Match", async () => {
    const response = await DELETE(mutate("DELETE", {}, { "if-match": "" }), params);

    expect(response.status).toBe(428);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("DELETE fails CSRF without a token", async () => {
    const response = await DELETE(mutate("DELETE", {}, { "x-csrf-token": "", cookie: "" }), params);

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("PATCH returns 500 when the update payload fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { photoId: PHOTO }, error: null });

    const response = await PATCH(mutate("PATCH", { caption: "x" }), params);

    expect(response.status).toBe(500);
  });

  it("DELETE returns 500 when the delete payload fails its contract", async () => {
    mocks.rpc.mockResolvedValue({ data: { photoId: PHOTO, status: "gone" }, error: null });

    const response = await DELETE(mutate("DELETE", {}), params);

    expect(response.status).toBe(500);
  });

  it("PATCH requires authentication after the CSRF and validation gates", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await PATCH(mutate("PATCH", { caption: "x" }), params);

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("PATCH can update only the category, leaving caption untouched", async () => {
    mocks.rpc.mockResolvedValue({
      data: { photoId: PHOTO, caption: null, category: "after", lockVersion: 3 },
      error: null,
    });

    const response = await PATCH(mutate("PATCH", { category: "after" }), params);

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "update_work_order_photo",
      expect.objectContaining({ p_caption: null, p_category: "after" }),
    );
  });

  it("GET rejects a malformed org id before touching the gateway", async () => {
    const response = await GET(getRequest(), {
      params: Promise.resolve({ orgId: "bad", photoId: PHOTO }),
    });

    expect(response.status).toBe(422);
    expect(mocks.resolveWorkOrderPhotoReadUrl).not.toHaveBeenCalled();
  });

  it("GET collapses an unexpected non-problem error into a 500", async () => {
    mocks.resolveWorkOrderPhotoReadUrl.mockRejectedValue(new Error("boom"));

    const response = await GET(getRequest(), params);

    expect(response.status).toBe(500);
  });

  it("PATCH maps an update-invalid guard to 422", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "PHOTO_UPDATE_INVALID" } });

    const response = await PATCH(mutate("PATCH", { caption: "x" }), params);

    expect(response.status).toBe(422);
  });
});
