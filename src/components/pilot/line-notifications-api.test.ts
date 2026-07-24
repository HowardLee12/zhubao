import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelNotification,
  connectLineChannel,
  disableLineChannel,
  fetchLineChannels,
  fetchNotifications,
  retryNotification,
} from "./line-notifications-api";
import { PilotApiError } from "./api";

const ORG = "20000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // A stable CSRF cookie so the mutating helpers can echo the double-submit token.
  vi.stubGlobal("document", { cookie: "renoly-csrf=csrf-token-value-0123456789-abcdefghij" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("line-notifications-api", () => {
  it("fetchLineChannels returns the data array", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: "c1" }] }));
    await expect(fetchLineChannels(ORG)).resolves.toEqual([{ id: "c1" }]);
  });

  it("connectLineChannel posts the credentials and returns the DTO", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: "c1", status: "active", credentialConfigured: true } }));
    const result = await connectLineChannel(ORG, {
      name: "OA",
      channelId: "cid",
      channelSecret: "s",
      accessToken: "t",
    });
    expect(result.credentialConfigured).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
  });

  it("disableLineChannel sends the reason", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: "c1", status: "disabled" } }));
    await expect(disableLineChannel(ORG, "c1", "手動")).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: "手動" });
  });

  it("disableLineChannel with no reason sends an empty object", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));
    await disableLineChannel(ORG, "c1");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({});
  });

  it("fetchNotifications builds the query string with status + pageSize", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [], meta: { hasMore: false, nextCursor: null } }));
    await fetchNotifications(ORG, { status: "failed", cursor: "abc", pageSize: 10 });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("status=failed");
    expect(String(url)).toContain("cursor=abc");
    expect(String(url)).toContain("pageSize=10");
  });

  it("retryNotification / cancelNotification resolve on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));
    await expect(retryNotification(ORG, "n1")).resolves.toBeUndefined();
    await expect(cancelNotification(ORG, "n1")).resolves.toBeUndefined();
  });

  it("throws a PilotApiError carrying the problem detail on a non-ok response", async () => {
    // A fresh Response per call — a body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ detail: "沒有權限" }, 403)));
    await expect(fetchLineChannels(ORG)).rejects.toBeInstanceOf(PilotApiError);
    const error = await fetchLineChannels(ORG).catch((cause: PilotApiError) => cause);
    expect(error).toBeInstanceOf(PilotApiError);
    expect((error as PilotApiError).status).toBe(403);
    expect((error as PilotApiError).message).toBe("沒有權限");
  });

  it("falls back to a generic message when the error body is unparseable", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(retryNotification(ORG, "n1")).rejects.toThrow(/服務暫時無法使用/);
  });
});
