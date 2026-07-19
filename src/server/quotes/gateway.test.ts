import { beforeEach, describe, expect, it, vi } from "vitest";

import { publicQuoteFixture, quoteFixtureIds } from "@/testing/quote-fixtures";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock("@/server/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));

import {
  authorizePublicQuoteRequest,
  respondToPublicQuote,
  resolvePublicQuote,
} from "./gateway";

const tokenHashHex = "a".repeat(64);
const clientIpHashHex = "c".repeat(64);

async function authorize(action: "view" | "respond") {
  mocks.rpc.mockResolvedValueOnce({ data: "allowed", error: null });
  return authorizePublicQuoteRequest({ tokenHashHex, clientIpHashHex, action });
}

describe("public quote gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdminSupabaseClient.mockReturnValue({ rpc: mocks.rpc });
  });

  it("consumes the shared IP and token budget before issuing an access grant", async () => {
    await expect(authorize("respond")).resolves.toBeDefined();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "consume_pilot_public_quote_rate_limit",
      {
        p_public_token_hash_hex: tokenHashHex,
        p_client_ip_hash_hex: clientIpHashHex,
        p_action: "respond",
      },
    );
  });

  it("maps an invalid link without exposing the database signal", async () => {
    mocks.rpc.mockResolvedValue({ data: "invalid", error: null });
    await expect(
      authorizePublicQuoteRequest({
        tokenHashHex,
        clientIpHashHex,
        action: "view",
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "PUBLIC_LINK_NOT_FOUND",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("stops when the shared IP or token budget is exhausted", async () => {
    mocks.rpc.mockResolvedValue({ data: "limited", error: null });
    await expect(
      authorizePublicQuoteRequest({
        tokenHashHex,
        clientIpHashHex,
        action: "view",
      }),
    ).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the shared limiter errors or returns an unknown status", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "PILOT_VALIDATION_FAILED" },
    });
    await expect(
      authorizePublicQuoteRequest({ tokenHashHex, clientIpHashHex, action: "view" }),
    ).rejects.toMatchObject({ status: 422 });

    mocks.rpc.mockResolvedValueOnce({ data: "unexpected", error: null });
    await expect(
      authorizePublicQuoteRequest({ tokenHashHex, clientIpHashHex, action: "view" }),
    ).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
  });

  it("parses the allowlisted public projection after authorization", async () => {
    const access = await authorize("view");
    mocks.rpc.mockResolvedValueOnce({ data: publicQuoteFixture(), error: null });

    await expect(resolvePublicQuote(access)).resolves.toEqual(publicQuoteFixture());
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "resolve_pilot_public_quote", {
      p_public_token_hash_hex: tokenHashHex,
    });
  });

  it("fails closed when the database projection violates the public schema", async () => {
    const access = await authorize("view");
    mocks.rpc.mockResolvedValueOnce({
      data: { ...publicQuoteFixture(), internalNotes: "must not escape" },
      error: null,
    });

    await expect(resolvePublicQuote(access)).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
  });

  it("does not allow a response grant to read a quote", async () => {
    const access = await authorize("respond");

    await expect(resolvePublicQuote(access)).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("records and parses a public decision after authorization", async () => {
    const record = {
      decision: "reject",
      recordedAt: "2026-07-19T07:00:00.000Z",
      displayName: "林太太",
      comment: "預算需要調整",
      replayed: false,
    };
    const access = await authorize("respond");
    mocks.rpc.mockResolvedValueOnce({ data: record, error: null });

    await expect(
      respondToPublicQuote({
        access,
        idempotencyKey: "decision-key",
        payload: {
          decision: "reject",
          displayName: "林太太",
          comment: "預算需要調整",
        },
        requestId: quoteFixtureIds.request,
      }),
    ).resolves.toEqual(record);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "respond_pilot_public_quote", {
      p_public_token_hash_hex: tokenHashHex,
      p_idempotency_key: "decision-key",
      p_payload: expect.objectContaining({ decision: "reject" }),
      p_request_id: quoteFixtureIds.request,
    });
  });

  it("maps response conflicts and rejects malformed decision records", async () => {
    const conflictAccess = await authorize("respond");
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "ACTIVE_VERSION_CHANGED" },
    });
    await expect(
      respondToPublicQuote({
        access: conflictAccess,
        idempotencyKey: "decision-key",
        payload: {
          decision: "accept",
          displayName: "林太太",
          comment: null,
        },
        requestId: quoteFixtureIds.request,
      }),
    ).rejects.toMatchObject({ status: 409, code: "ACTIVE_VERSION_CHANGED" });

    const malformedAccess = await authorize("respond");
    mocks.rpc.mockResolvedValueOnce({ data: { decision: "accept" }, error: null });
    await expect(
      respondToPublicQuote({
        access: malformedAccess,
        idempotencyKey: "decision-key-2",
        payload: {
          decision: "accept",
          displayName: "林太太",
          comment: null,
        },
        requestId: quoteFixtureIds.request,
      }),
    ).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});
