import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAdmin, createSignedUploadUrl, createSignedUrl, download, imageSizeMock } =
  vi.hoisted(() => {
    const createSignedUploadUrl = vi.fn();
    const createSignedUrl = vi.fn();
    const download = vi.fn();
    const imageSizeMock = vi.fn();
    return {
      createSignedUploadUrl,
      createSignedUrl,
      download,
      imageSizeMock,
      // Storage signer only — no domain-table `from`, so a regression to
      // service-role SQL through this credential would fail the type/call here.
      createAdmin: vi.fn(() => ({
        storage: {
          from: vi.fn(() => ({ createSignedUploadUrl, createSignedUrl, download })),
        },
      })),
    };
  });

vi.mock("@/server/supabase/admin", () => ({ createAdminSupabaseClient: createAdmin }));
vi.mock("image-size", () => ({ imageSize: imageSizeMock }));

import {
  actualWorkMediaMime,
  computeWorkMediaActuals,
  signWorkMediaReadUrl,
  signWorkMediaUploadUrl,
  WORK_MEDIA_BUCKET,
} from "./work-order-photos";

// A real 1x1 PNG (signature + IHDR the sniffer recognizes).
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function jpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
}

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  "RIFF".split("").forEach((c, i) => (bytes[i] = c.charCodeAt(0)));
  "WEBP".split("").forEach((c, i) => (bytes[8 + i] = c.charCodeAt(0)));
  return bytes;
}

function blobOf(bytes: Uint8Array): { arrayBuffer: () => Promise<ArrayBuffer> } {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return { arrayBuffer: async () => copy };
}

describe("actualWorkMediaMime magic-byte sniffing", () => {
  it("recognizes a JPEG start-of-image marker", () => {
    expect(actualWorkMediaMime(jpegBytes())).toBe("image/jpeg");
  });

  it("recognizes the 8-byte PNG signature", () => {
    expect(actualWorkMediaMime(new Uint8Array(PNG_1X1))).toBe("image/png");
  });

  it("recognizes a RIFF/WEBP container", () => {
    expect(actualWorkMediaMime(webpBytes())).toBe("image/webp");
  });

  it("returns null for bytes that match no known signature", () => {
    expect(actualWorkMediaMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it("returns null for a too-short buffer", () => {
    expect(actualWorkMediaMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("signWorkMediaUploadUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mints a signed PUT url from the private work-media bucket", async () => {
    createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/put" },
      error: null,
    });

    const result = await signWorkMediaUploadUrl("org/x/work-orders/w/p/upload");

    expect(createSignedUploadUrl).toHaveBeenCalledWith("org/x/work-orders/w/p/upload", {
      upsert: false,
    });
    expect(result.method).toBe("PUT");
    expect(result.url).toBe("https://signed.example/put");
    expect(result.headers["x-upsert"]).toBe("false");
    expect(Number.isFinite(Date.parse(result.expiresAt))).toBe(true);
  });

  it("raises a 500 problem when the signer fails", async () => {
    createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: "down" } });

    await expect(signWorkMediaUploadUrl("p")).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
  });

  it("raises a 500 problem when the signer returns no url", async () => {
    createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: "" }, error: null });

    await expect(signWorkMediaUploadUrl("p")).rejects.toMatchObject({ status: 500 });
  });
});

describe("signWorkMediaReadUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mints a short-lived signed READ url", async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/get" },
      error: null,
    });

    const result = await signWorkMediaReadUrl("org/x/p");

    expect(createSignedUrl).toHaveBeenCalledWith("org/x/p", 300);
    expect(result.url).toBe("https://signed.example/get");
    expect(Number.isFinite(Date.parse(result.expiresAt))).toBe(true);
  });

  it("raises a non-leaky 404 problem when the object cannot be signed", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "missing" } });

    await expect(signWorkMediaReadUrl("p")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});

describe("computeWorkMediaActuals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageSizeMock.mockReturnValue({ width: 1, height: 1, type: "png" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("downloads the object and returns real mime/size/sha256/dimensions", async () => {
    download.mockResolvedValue({ data: blobOf(new Uint8Array(PNG_1X1)), error: null });

    const actuals = await computeWorkMediaActuals("org/x/p");

    expect(download).toHaveBeenCalledWith("org/x/p");
    expect(actuals.mimeType).toBe("image/png");
    expect(actuals.byteSize).toBe(PNG_1X1.byteLength);
    expect(actuals.width).toBe(1);
    expect(actuals.height).toBe(1);
    expect(actuals.sha256).toBe(
      createHash("sha256").update(new Uint8Array(PNG_1X1)).digest("hex"),
    );
  });

  it("rejects with a 422 photo-verification problem when the download fails", async () => {
    download.mockResolvedValue({ data: null, error: { message: "gone" } });

    await expect(computeWorkMediaActuals("p")).rejects.toMatchObject({
      status: 422,
      code: "PHOTO_VERIFICATION_INVALID",
    });
  });

  it("rejects with a 422 when image-size throws on a corrupt object", async () => {
    download.mockResolvedValue({ data: blobOf(new Uint8Array(PNG_1X1)), error: null });
    imageSizeMock.mockImplementation(() => {
      throw new Error("bad image");
    });

    await expect(computeWorkMediaActuals("p")).rejects.toMatchObject({ status: 422 });
  });

  it("rejects with a 422 when magic bytes do not match a supported image", async () => {
    download.mockResolvedValue({
      data: blobOf(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])),
      error: null,
    });
    imageSizeMock.mockReturnValue({ width: 1, height: 1 });

    await expect(computeWorkMediaActuals("p")).rejects.toMatchObject({ status: 422 });
  });

  it("rejects with a 422 when the decoded dimensions exceed the safety bounds", async () => {
    download.mockResolvedValue({ data: blobOf(new Uint8Array(PNG_1X1)), error: null });
    imageSizeMock.mockReturnValue({ width: 20_000, height: 20_000 });

    await expect(computeWorkMediaActuals("p")).rejects.toMatchObject({ status: 422 });
  });

  it("rejects with a 422 when width or height is missing", async () => {
    download.mockResolvedValue({ data: blobOf(new Uint8Array(PNG_1X1)), error: null });
    imageSizeMock.mockReturnValue({ width: 0, height: 0 });

    await expect(computeWorkMediaActuals("p")).rejects.toMatchObject({ status: 422 });
  });
});

describe("WORK_MEDIA_BUCKET", () => {
  it("is the private work-media bucket", () => {
    expect(WORK_MEDIA_BUCKET).toBe("work-media");
  });
});
