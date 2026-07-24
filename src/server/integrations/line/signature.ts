import { createHmac, timingSafeEqual } from "node:crypto";

// LINE signs each webhook delivery with base64(HMAC-SHA256(channelSecret, rawBody)).
// The signature arrives in the `x-line-signature` header. Verification MUST run over
// the exact raw request bytes (not a re-serialized JSON) — the route reads
// request.arrayBuffer() before any parse and passes those bytes here.
//
// The channel secret is an INJECTABLE seam: tests pass the plaintext secret; the
// webhook route decrypts it from private.line_channel_credentials just-in-time. This
// function never reaches for env or a client — it is a pure, side-effect-free check.
//
// Failure is total and silent (returns false) — a malformed header, wrong length,
// non-base64 signature, empty secret or a tampered body all fail closed without
// throwing, so the caller maps every negative to a single 401.

export function verifyLineSignature(
  rawBody: Uint8Array,
  header: string | undefined | null,
  secret: string,
): boolean {
  if (!header || !secret) return false;

  // Buffer.from(..., "base64") is lenient and never throws — garbage decodes to a
  // buffer of the wrong length, which the guard below rejects.
  const provided = Buffer.from(header, "base64");

  // A base64-decode of garbage yields a buffer of the wrong length; guard the length
  // before the constant-time compare (timingSafeEqual throws on a length mismatch).
  // The comparison is over the decoded HMAC bytes, so non-canonical base64 that
  // happens to decode to the wrong bytes simply fails the compare.
  const expected = createHmac("sha256", secret).update(Buffer.from(rawBody)).digest();
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}
