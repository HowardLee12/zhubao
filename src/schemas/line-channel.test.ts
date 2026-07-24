import { describe, expect, it } from "vitest";

import {
  lineChannelConnectSchema,
  lineChannelDisableSchema,
  lineChannelRotateTokenSchema,
  lineChannelUpdateSchema,
  lineChannelViewSchema,
} from "./line-channel";

const validConnect = {
  name: "Renoly 冷氣清洗",
  channelId: "2001234567",
  channelSecret: "0123456789abcdef0123456789abcdef",
  accessToken: "long-lived-channel-access-token",
};

describe("lineChannelConnectSchema", () => {
  it("accepts a minimal valid connect body", () => {
    expect(lineChannelConnectSchema.safeParse(validConnect).success).toBe(true);
  });

  it("accepts optional basicId, liffId, tokenExpiresAt", () => {
    expect(
      lineChannelConnectSchema.safeParse({
        ...validConnect,
        basicId: "@renoly",
        liffId: "2001234567-abcd",
        tokenExpiresAt: "2027-01-01T00:00:00+00:00",
      }).success,
    ).toBe(true);
  });

  it("rejects an empty secret", () => {
    expect(lineChannelConnectSchema.safeParse({ ...validConnect, channelSecret: "" }).success).toBe(
      false,
    );
  });

  it("rejects unknown keys (strict)", () => {
    expect(
      lineChannelConnectSchema.safeParse({ ...validConnect, webhookUrl: "https://x" }).success,
    ).toBe(false);
  });

  it("rejects a non-datetime tokenExpiresAt", () => {
    expect(
      lineChannelConnectSchema.safeParse({ ...validConnect, tokenExpiresAt: "not-a-date" }).success,
    ).toBe(false);
  });
});

describe("lineChannelUpdateSchema", () => {
  it("accepts a single metadata field", () => {
    expect(lineChannelUpdateSchema.safeParse({ name: "改名" }).success).toBe(true);
  });

  it("rejects an empty object (nothing to update)", () => {
    expect(lineChannelUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a credential field appearing in a metadata update", () => {
    expect(lineChannelUpdateSchema.safeParse({ channelSecret: "x" }).success).toBe(false);
  });
});

describe("lineChannelRotateTokenSchema", () => {
  it("accepts a new token", () => {
    expect(lineChannelRotateTokenSchema.safeParse({ accessToken: "new-token" }).success).toBe(true);
  });

  it("rejects a missing token", () => {
    expect(lineChannelRotateTokenSchema.safeParse({}).success).toBe(false);
  });
});

describe("lineChannelDisableSchema", () => {
  it("accepts an empty body (reason optional)", () => {
    expect(lineChannelDisableSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a bounded reason", () => {
    expect(lineChannelDisableSchema.safeParse({ reason: "疑似外洩，先停用" }).success).toBe(true);
  });

  it("rejects an over-long reason", () => {
    expect(lineChannelDisableSchema.safeParse({ reason: "x".repeat(2_001) }).success).toBe(false);
  });
});

describe("lineChannelViewSchema", () => {
  it("accepts a redacted view with credentialConfigured boolean only", () => {
    expect(
      lineChannelViewSchema.safeParse({
        id: "a1c00000-0000-4000-8000-000000000001",
        name: "Renoly",
        channelId: "2001234567",
        basicId: null,
        liffId: null,
        status: "active",
        credentialConfigured: true,
        webhookVerifiedAt: null,
        lastWebhookAt: null,
        lastErrorCode: null,
        lockVersion: 1,
      }).success,
    ).toBe(true);
  });

  it("rejects a view that tries to leak ciphertext", () => {
    expect(
      lineChannelViewSchema.safeParse({
        id: "a1c00000-0000-4000-8000-000000000001",
        name: "Renoly",
        channelId: "2001234567",
        basicId: null,
        liffId: null,
        status: "active",
        credentialConfigured: true,
        webhookVerifiedAt: null,
        lastWebhookAt: null,
        lastErrorCode: null,
        lockVersion: 1,
        secretCiphertext: "deadbeef",
      }).success,
    ).toBe(false);
  });
});
