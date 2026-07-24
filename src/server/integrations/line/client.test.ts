import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  classifyPushFailure,
  createLineMessenger,
  FakeLineMessenger,
  RealLineMessenger,
  type PushMessageCommand,
} from "./client";

const command: PushMessageCommand = {
  lineChannelId: "a1c00000-0000-4000-8000-000000000001",
  accessToken: "channel-access-token",
  to: "Uline-alpha-customer-0001",
  messages: [{ type: "text", text: "已收到您的需求" }],
};

describe("FakeLineMessenger", () => {
  it("returns sent with a provider message id by default", async () => {
    const messenger = new FakeLineMessenger();
    const result = await messenger.pushMessage(command);
    expect(result.status).toBe("sent");
    if (result.status === "sent") {
      expect(result.providerMessageId).toMatch(/^fake-/);
    }
    expect(messenger.sent).toHaveLength(1);
    expect(messenger.sent[0]?.to).toBe("Uline-alpha-customer-0001");
  });

  it("can be configured to fail with a retriable 429", async () => {
    const messenger = new FakeLineMessenger({ mode: "rate_limited" });
    const result = await messenger.pushMessage(command);
    expect(result.status).toBe("retriable");
    if (result.status !== "sent") expect(result.errorCode).toBe("RATE_LIMITED");
  });

  it("can be configured to fail with a retriable 5xx", async () => {
    const messenger = new FakeLineMessenger({ mode: "server_error" });
    const result = await messenger.pushMessage(command);
    expect(result.status).toBe("retriable");
  });

  it("can be configured to fail permanently with a 4xx", async () => {
    const messenger = new FakeLineMessenger({ mode: "bad_request" });
    const result = await messenger.pushMessage(command);
    expect(result.status).toBe("permanent");
    if (result.status !== "sent") expect(result.errorCode).toBe("INVALID_REQUEST");
  });

  it("records every attempt for assertion, even failures", async () => {
    const messenger = new FakeLineMessenger({ mode: "server_error" });
    await messenger.pushMessage(command);
    expect(messenger.attempts).toHaveLength(1);
    expect(messenger.sent).toHaveLength(0);
  });
});

describe("RealLineMessenger (deferred real-channel seam)", () => {
  it("typechecks but throws when invoked without real wiring", async () => {
    const messenger = new RealLineMessenger();
    await expect(messenger.pushMessage(command)).rejects.toThrow(/not implemented/i);
  });
});

describe("createLineMessenger factory", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.LINE_CHANNEL_LIVE;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.LINE_CHANNEL_LIVE;
    else process.env.LINE_CHANNEL_LIVE = saved;
  });

  it("returns the fake messenger when live env is absent", () => {
    delete process.env.LINE_CHANNEL_LIVE;
    expect(createLineMessenger()).toBeInstanceOf(FakeLineMessenger);
  });

  it("returns the real messenger when live env is present", () => {
    process.env.LINE_CHANNEL_LIVE = "1";
    expect(createLineMessenger()).toBeInstanceOf(RealLineMessenger);
  });
});

describe("classifyPushFailure", () => {
  it("maps a retriable result to the retriable class", () => {
    expect(classifyPushFailure({ status: "retriable", errorCode: "RATE_LIMITED" })).toBe(
      "retriable",
    );
  });

  it("maps a permanent result to the permanent class", () => {
    expect(classifyPushFailure({ status: "permanent", errorCode: "INVALID_REQUEST" })).toBe(
      "permanent",
    );
  });
});
