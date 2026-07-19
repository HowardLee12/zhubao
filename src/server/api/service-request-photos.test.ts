import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdmin, storageFrom, createSignedUrl } = vi.hoisted(() => {
  const createSignedUrl = vi.fn();
  const storageFrom = vi.fn(() => ({ createSignedUrl }));
  return {
    createSignedUrl,
    storageFrom,
    // Deliberately no domain-table `from` method: this credential is a storage
    // signer only and a regression to service-role SQL will fail this test.
    createAdmin: vi.fn(() => ({ storage: { from: storageFrom } })),
  };
});

vi.mock("@/server/supabase/admin", () => ({ createAdminSupabaseClient: createAdmin }));

import { signServiceRequestPhotos } from "./service-request-photos";

describe("signServiceRequestPhotos", () => {
  const photoRows = [
    {
      id: "a0000000-0000-4000-8000-000000000001",
      category: "intake",
      storage_path: "org/x/photo",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/photo" },
      error: null,
    });
  });

  it("mints signed URLs from metadata already authorized by the RPC", async () => {
    const result = await signServiceRequestPhotos(photoRows);

    expect(storageFrom).toHaveBeenCalledWith("v2-intake-photos");
    expect(createSignedUrl).toHaveBeenCalledWith("org/x/photo", 300);
    expect(result[0].url).toBe("https://signed.example/photo");
    expect(result[0].category).toBe("intake");
    expect(Number.isFinite(Date.parse(result[0].expiresAt))).toBe(true);
  });

  it("does not create a service client when there are no photos", async () => {
    await expect(signServiceRequestPhotos([])).resolves.toEqual([]);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("skips a photo whose signing fails rather than failing the detail page", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "no" } });
    await expect(signServiceRequestPhotos(photoRows)).resolves.toEqual([]);
  });

  it("never returns the private storage path", async () => {
    const result = await signServiceRequestPhotos(photoRows);
    expect(JSON.stringify(result)).not.toContain("org/x/photo");
  });
});
