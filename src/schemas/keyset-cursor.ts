import { z } from "zod";

// Opaque keyset pagination cursor. The list route encodes the last item's
// (createdAt, id) tuple as base64url of a small JSON object; the client treats
// it as opaque. Decoding validates the shape strictly so a tampered or truncated
// cursor is rejected rather than silently paging from an unexpected position.

export interface KeysetPosition {
  createdAt: string;
  id: string;
}

const keysetPositionSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict();

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

export function encodeKeysetCursor(position: KeysetPosition): string {
  const validated = keysetPositionSchema.parse(position);
  return toBase64Url(JSON.stringify(validated));
}

export function decodeKeysetCursor(cursor: string): KeysetPosition {
  if (!CURSOR_PATTERN.test(cursor)) {
    throw new Error("INVALID_CURSOR");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(cursor));
  } catch {
    throw new Error("INVALID_CURSOR");
  }

  const result = keysetPositionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("INVALID_CURSOR");
  }
  return result.data;
}
