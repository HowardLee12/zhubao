import { describe, expect, it } from "vitest";

import { decodeKeysetCursor, encodeKeysetCursor } from "./keyset-cursor";

describe("keyset cursor", () => {
  const key = {
    createdAt: "2026-07-16T10:00:00.000Z",
    id: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
  };

  it("round-trips a keyset position through an opaque base64url token", () => {
    const cursor = encodeKeysetCursor(key);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor.length).toBeGreaterThanOrEqual(16);
    expect(decodeKeysetCursor(cursor)).toEqual(key);
  });

  it("rejects a malformed cursor token shape", () => {
    expect(() => decodeKeysetCursor("not base64!!")).toThrow();
  });

  it("rejects a cursor whose payload is not the expected key shape", () => {
    const bad = Buffer.from(JSON.stringify({ foo: "bar" }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(() => decodeKeysetCursor(bad)).toThrow();
  });

  it("rejects a cursor whose id is not a uuid", () => {
    const bad = encodeKeysetCursor({ ...key, id: key.id }).slice(0, 4) + "@@@@";
    expect(() => decodeKeysetCursor(bad)).toThrow();
  });
});
