import { afterEach, describe, expect, it, vi } from "vitest";

const { resolvePublicIntakeConfig } = vi.hoisted(() => ({
  resolvePublicIntakeConfig: vi.fn(),
}));

vi.mock("@/server/public-intake/gateway", () => ({
  resolvePublicIntakeConfig,
}));

import { GET } from "./route";

const validToken = "x".repeat(43);

describe("GET /api/v2/public/intake/:token", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns only the public form configuration", async () => {
    resolvePublicIntakeConfig.mockResolvedValue({
      merchantName: "北城工程",
      headline: "描述需求，我們確認後聯絡您",
      serviceCatalogItems: [
        { id: "2f66bf0a-b8d9-4722-9e2a-23f218f25d86", name: "現場估價", category: "裝修" },
      ],
      photoLimit: 3,
      acceptedPhotoTypes: ["image/jpeg", "image/png", "image/webp"],
      privacyNotice: "資料僅供本次服務聯繫使用。",
    });

    const response = await GET(
      new Request(`https://renoly.test/api/v2/public/intake/${validToken}`),
      { params: Promise.resolve({ token: validToken }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: expect.objectContaining({
        submissionId: expect.any(String),
        merchantName: "北城工程",
        serviceCatalogItems: expect.any(Array),
      }),
    });
    expect(resolvePublicIntakeConfig).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(resolvePublicIntakeConfig).not.toHaveBeenCalledWith(validToken);
  });

  it("returns an indistinguishable 404 for malformed capability tokens", async () => {
    const response = await GET(
      new Request("https://renoly.test/api/v2/public/intake/bad-token"),
      { params: Promise.resolve({ token: "bad-token" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "PUBLIC_LINK_NOT_FOUND" });
    expect(resolvePublicIntakeConfig).not.toHaveBeenCalled();
  });
});
