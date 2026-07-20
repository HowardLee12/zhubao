import { afterEach, describe, expect, it } from "vitest";

import {
  createLineContentFetcher,
  FakeLineContentFetcher,
  RealLineContentFetcher,
} from "./content-fetcher";

const ORIGINAL = process.env.LINE_CHANNEL_LIVE;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.LINE_CHANNEL_LIVE;
  else process.env.LINE_CHANNEL_LIVE = ORIGINAL;
});

const command = {
  lineChannelId: "a1c00000-0000-4000-8000-000000000001",
  accessToken: "test-token",
  lineMessageId: "m-0001",
};

describe("FakeLineContentFetcher", () => {
  it("returns fixed deterministic bytes and records every call", async () => {
    const fetcher = new FakeLineContentFetcher();
    const first = await fetcher.fetchContent(command);
    const second = await fetcher.fetchContent(command);

    expect(first.bytes).toEqual(second.bytes);
    expect(first.mimeType).toBe("image/png");
    expect(first.bytes.byteLength).toBeGreaterThan(0);
    expect(fetcher.calls).toHaveLength(2);
    expect(fetcher.calls[0]?.lineMessageId).toBe("m-0001");
  });

  it("honours a configured fixed mime type and bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetcher = new FakeLineContentFetcher({ bytes, mimeType: "image/jpeg" });
    const result = await fetcher.fetchContent(command);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.bytes).toEqual(bytes);
  });
});

describe("RealLineContentFetcher (deferred real seam)", () => {
  it("throws because the real LINE content download is not wired yet", async () => {
    const fetcher = new RealLineContentFetcher();
    await expect(fetcher.fetchContent(command)).rejects.toThrow(/not implemented/i);
  });
});

describe("createLineContentFetcher", () => {
  it("returns the Fake fetcher when LINE_CHANNEL_LIVE is unset", () => {
    delete process.env.LINE_CHANNEL_LIVE;
    expect(createLineContentFetcher()).toBeInstanceOf(FakeLineContentFetcher);
  });

  it("selects the deferred Real fetcher only when the live channel is enabled", () => {
    process.env.LINE_CHANNEL_LIVE = "1";
    expect(createLineContentFetcher()).toBeInstanceOf(RealLineContentFetcher);
  });
});
