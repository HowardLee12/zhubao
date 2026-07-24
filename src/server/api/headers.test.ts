import { describe, expect, it } from "vitest";

import { parseIdempotencyKey, parseIfMatch, requireStaffIdempotencyKey } from "./headers";

describe("parseIfMatch", () => {
  it("parses the documented strong ETag", () => {
    expect(parseIfMatch('"3"')).toBe(3);
  });

  it.each([null, undefined, "", "3", 'W/"3"', '"0"', '"1.5"']) (
    "rejects a missing or malformed value: %s",
    (value) => {
      expect(() => parseIfMatch(value)).toThrowError(
        expect.objectContaining({ code: value ? "VALIDATION_FAILED" : "IF_MATCH_REQUIRED" }),
      );
    },
  );
});

describe("parseIdempotencyKey", () => {
  it("accepts a scoped opaque key", () => {
    expect(parseIdempotencyKey("quote-send:01J0XKZ2KSQ7J8JQM2K5")).toBe(
      "quote-send:01J0XKZ2KSQ7J8JQM2K5",
    );
  });

  it.each([null, "short", "contains spaces", "x".repeat(129)])(
    "rejects an unsafe key: %s",
    (value) => {
      expect(() => parseIdempotencyKey(value)).toThrowError(
        expect.objectContaining({ code: value ? "VALIDATION_FAILED" : "IDEMPOTENCY_KEY_REQUIRED" }),
      );
    },
  );
});

describe("requireStaffIdempotencyKey", () => {
  it("accepts a scoped opaque key", () => {
    expect(requireStaffIdempotencyKey("org-create:01J0XKZ2KSQ7J8JQM2K5")).toBe(
      "org-create:01J0XKZ2KSQ7J8JQM2K5",
    );
  });

  it("rejects a missing key with a 400", () => {
    expect(() => requireStaffIdempotencyKey(null)).toThrowError(
      expect.objectContaining({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" }),
    );
  });

  it.each(["short", "contains spaces", "x".repeat(129)])(
    "rejects a malformed key with a 400: %s",
    (value) => {
      expect(() => requireStaffIdempotencyKey(value)).toThrowError(
        expect.objectContaining({ status: 400, code: "IDEMPOTENCY_KEY_INVALID" }),
      );
    },
  );
});
