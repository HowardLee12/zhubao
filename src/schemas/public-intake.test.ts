import { describe, expect, it } from "vitest";

import {
  normalizeTaiwanPhone,
  publicPhotoCompleteRequestSchema,
  publicPhotoUploadRequestSchema,
  publicServiceRequestRequestSchema,
} from "./public-intake";

const validRequest = {
  submissionId: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
  contactName: "王先生",
  contactPhone: "0912 345 678",
  serviceCatalogItemId: "2f66bf0a-b8d9-4722-9e2a-23f218f25d86",
  title: "主臥冷氣不冷",
  description: "運轉十分鐘後只剩送風",
  address: {
    postalCode: "105",
    county: "台北市",
    district: "松山區",
    addressLine: "民生東路四段 88 號",
    accessNotes: "請從側門進入",
  },
  preferredWindows: [
    {
      startsAt: "2026-08-10T01:00:00.000Z",
      endsAt: "2026-08-10T04:00:00.000Z",
      preferenceRank: 1,
    },
  ],
  photoIds: [],
  privacyAccepted: true,
  companyWebsite: "",
};

describe("normalizeTaiwanPhone", () => {
  it.each([
    ["0912 345 678", "+886912345678"],
    ["0912-345-678", "+886912345678"],
    ["+886 912 345 678", "+886912345678"],
  ])("normalizes %s to E.164", (input, expected) => {
    expect(normalizeTaiwanPhone(input)).toBe(expected);
  });

  it.each(["", "12345", "8860912345678", "+886021234567890123"])(
    "rejects unsupported phone %s",
    (input) => {
      expect(() => normalizeTaiwanPhone(input)).toThrow("INVALID_PHONE");
    },
  );
});

describe("publicServiceRequestRequestSchema", () => {
  it("normalizes a valid no-account intake request", () => {
    const result = publicServiceRequestRequestSchema.parse(validRequest);

    expect(result.contactPhone).toBe("+886912345678");
    expect(result.privacyAccepted).toBe(true);
  });

  it("pins addressLine to the database bound of 300 characters", () => {
    const withAddress = (addressLine: string) => ({
      ...validRequest,
      address: { ...validRequest.address, addressLine },
    });

    expect(() =>
      publicServiceRequestRequestSchema.parse(withAddress("路".repeat(300))),
    ).not.toThrow();
    expect(() =>
      publicServiceRequestRequestSchema.parse(withAddress("路".repeat(301))),
    ).toThrow();
  });

  it("allows the customer to submit without choosing a time window", () => {
    expect(
      publicServiceRequestRequestSchema.parse({ ...validRequest, preferredWindows: [] })
        .preferredWindows,
    ).toEqual([]);
  });

  it("requires privacy consent", () => {
    expect(() =>
      publicServiceRequestRequestSchema.parse({ ...validRequest, privacyAccepted: false }),
    ).toThrow();
  });

  it("rejects a filled honeypot", () => {
    expect(() =>
      publicServiceRequestRequestSchema.parse({
        ...validRequest,
        companyWebsite: "https://spam.invalid",
      }),
    ).toThrow();
  });

  it("rejects overlapping ranks and inverted windows", () => {
    expect(() =>
      publicServiceRequestRequestSchema.parse({
        ...validRequest,
        preferredWindows: [
          {
            startsAt: "2026-08-10T04:00:00.000Z",
            endsAt: "2026-08-10T01:00:00.000Z",
            preferenceRank: 1,
          },
          {
            startsAt: "2026-08-11T01:00:00.000Z",
            endsAt: "2026-08-11T04:00:00.000Z",
            preferenceRank: 1,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects unknown fields", () => {
    expect(() =>
      publicServiceRequestRequestSchema.parse({ ...validRequest, organizationId: crypto.randomUUID() }),
    ).toThrow();
  });
});

describe("publicPhotoUploadRequestSchema", () => {
  it("accepts a declared JPEG under 10 MiB", () => {
    expect(
      publicPhotoUploadRequestSchema.parse({
        submissionId: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
        filename: "室內機.jpg",
        contentType: "image/jpeg",
        byteSize: 1024,
        sha256: "a".repeat(64),
      }),
    ).toEqual({
      submissionId: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
      filename: "室內機.jpg",
      contentType: "image/jpeg",
      byteSize: 1024,
      sha256: "a".repeat(64),
    });
  });

  it.each([
    { contentType: "image/heic", byteSize: 1024, sha256: "a".repeat(64) },
    { contentType: "image/jpeg", byteSize: 10 * 1024 * 1024 + 1, sha256: "a".repeat(64) },
    { contentType: "image/jpeg", byteSize: 1024, sha256: "not-a-checksum" },
  ])("rejects unsafe upload metadata %#", (override) => {
    expect(() =>
      publicPhotoUploadRequestSchema.parse({
        submissionId: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
        filename: "photo.jpg",
        ...override,
      }),
    ).toThrow();
  });
});

describe("publicPhotoCompleteRequestSchema", () => {
  it("accepts only the public submission correlation id", () => {
    expect(
      publicPhotoCompleteRequestSchema.parse({
        submissionId: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
      }),
    ).toEqual({ submissionId: "4c76d4c5-c978-4bdb-a918-caa82988e5fa" });

    expect(() =>
      publicPhotoCompleteRequestSchema.parse({
        submissionId: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
        storagePath: "tenant/private.jpg",
      }),
    ).toThrow();
  });
});
