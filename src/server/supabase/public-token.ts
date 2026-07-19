import { createHash, randomBytes } from "node:crypto";

export interface PublicIntakeToken {
  rawToken: string;
  hashHex: string;
}

export function createPublicIntakeToken(): PublicIntakeToken {
  const rawToken = randomBytes(32).toString("base64url");
  const hashHex = createHash("sha256")
    .update(rawToken, "utf8")
    .digest("hex");

  return { rawToken, hashHex };
}
