import { describe, expect, it } from "vitest";

import {
  hashClientIp,
  hashPublicToken,
  requirePublicBearerToken,
  requirePublicToken,
  resolveClientIp,
} from "./security";

describe("public intake capability security", () => {
  const token = "x".repeat(43);

  it("accepts a 32-byte base64url capability and hashes it deterministically", () => {
    expect(requirePublicToken(token)).toBe(token);
    expect(hashPublicToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPublicToken(token)).toBe(hashPublicToken(token));
    expect(hashPublicToken(`${"y".repeat(43)}`)).not.toBe(hashPublicToken(token));
  });

  it.each([
    "short",
    `${"a".repeat(42)}=`,
    `${"a".repeat(44)}`,
    `${"a".repeat(42)}/`,
  ])("hides malformed capability tokens behind a not-found response", (input) => {
    expect(() => requirePublicToken(input)).toThrow(
      expect.objectContaining({ status: 404, code: "PUBLIC_LINK_NOT_FOUND" }),
    );
  });

  it("reads a capability from an Authorization bearer header without putting it in the URL", () => {
    const request = new Request("https://renoly.test/api/v2/public/quotes/current", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(requirePublicBearerToken(request)).toBe(token);
  });

  it.each([null, "", "Basic abc", "Bearer short", `bearer ${token}`, `Bearer ${token} extra`])(
    "hides a malformed public Authorization header %s behind not-found",
    (authorization) => {
      const request = new Request("https://renoly.test/api/v2/public/quotes/current", {
        headers: authorization ? { authorization } : {},
      });
      expect(() => requirePublicBearerToken(request)).toThrow(
        expect.objectContaining({ status: 404, code: "PUBLIC_LINK_NOT_FOUND" }),
      );
    },
  );

  it("selects the untrusted hop nearest the trusted proxy, ignoring client-forged left entries", () => {
    // A client-forged left-most entry (attacker-controlled) must NOT be chosen.
    // With one trusted proxy in front of the app, the right-most XFF entry is the
    // address the trusted proxy observed and appended, so it is the value to key on.
    const request = new Request("https://renoly.test/request", {
      headers: { "x-forwarded-for": " 1.2.3.4, 203.0.113.7, 198.51.100.9 " },
    });

    expect(resolveClientIp(request)).toBe("198.51.100.9");
    const digest = hashClientIp(request, "p".repeat(32));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("198.51.100.9");
  });

  it("honors the configured trusted-proxy depth when picking the untrusted hop", () => {
    const previous = process.env.PUBLIC_TRUSTED_PROXY_COUNT;
    process.env.PUBLIC_TRUSTED_PROXY_COUNT = "2";
    try {
      const request = new Request("https://renoly.test/request", {
        headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7, 10.0.0.1, 10.0.0.2" },
      });
      // Two trusted proxies means the two right-most entries are trusted hops;
      // the untrusted client address is the next one to the left.
      expect(resolveClientIp(request)).toBe("203.0.113.7");
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_TRUSTED_PROXY_COUNT;
      else process.env.PUBLIC_TRUSTED_PROXY_COUNT = previous;
    }
  });

  it("falls back to the left-most valid entry when the chain is shorter than the trusted depth", () => {
    // A forged single-entry XFF cannot masquerade as more hops than exist; when the
    // chain is shorter than the trusted-proxy depth we cannot trust any entry, so we
    // key on the left-most parseable value (worst case: the same as no proxy).
    const request = new Request("https://renoly.test/request", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    // Default depth 1 → single entry is the untrusted hop.
    expect(resolveClientIp(request)).toBe("203.0.113.7");
  });

  it("keeps the trusted right-most hop when an attacker pads the chain past the entry cap", () => {
    // 25 forged left-side hops; the trusted edge appends the real peer last.
    // Truncation must drop the OLDEST (left-most) entries, never the trusted one.
    const forged = Array.from({ length: 25 }, (_, i) => `9.9.9.${i + 1}`).join(", ");
    const request = new Request("https://renoly.test/request", {
      headers: { "x-forwarded-for": `${forged}, 203.0.113.99` },
    });

    expect(resolveClientIp(request)).toBe("203.0.113.99");
  });

  it("prefers x-real-ip only when no forwarded chain is present", () => {
    const request = new Request("https://renoly.test/request", {
      headers: { "x-real-ip": "203.0.113.20" },
    });
    expect(resolveClientIp(request)).toBe("203.0.113.20");
  });

  it("uses a stable non-identifying fallback when no platform address exists", () => {
    const request = new Request("https://renoly.test/request");
    expect(resolveClientIp(request)).toBe("unknown");
    expect(hashClientIp(request, "p".repeat(32))).toHaveLength(64);
  });

  it("requires a sufficiently strong server-side IP pepper", () => {
    expect(() =>
      hashClientIp(new Request("https://renoly.test/request"), "too-short"),
    ).toThrow("PUBLIC_TOKEN_PEPPER");
  });
});
