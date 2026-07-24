import { describe, expect, it } from "vitest";

import { photoUpdateSchema, photoUploadCreateSchema } from "./work-order-photo";

const validUpload = {
  category: "before" as const,
  filename: "site.jpg",
  contentType: "image/jpeg" as const,
  byteSize: 12345,
  sha256: "a".repeat(64),
};

describe("work-order photo schemas", () => {
  it("accepts a valid upload declaration", () => {
    expect(photoUploadCreateSchema.safeParse(validUpload).success).toBe(true);
  });

  it("rejects a non-hex sha256 and disallowed content type", () => {
    expect(photoUploadCreateSchema.safeParse({ ...validUpload, sha256: "z".repeat(64) }).success).toBe(
      false,
    );
    expect(
      photoUploadCreateSchema.safeParse({ ...validUpload, contentType: "image/gif" }).success,
    ).toBe(false);
  });

  it("requires at least one field to patch", () => {
    expect(photoUpdateSchema.safeParse({}).success).toBe(false);
    expect(photoUpdateSchema.safeParse({ category: "after" }).success).toBe(true);
  });
});
