import { randomUUID } from "node:crypto";

import type { NotificationFailureClass } from "@/schemas/notification";

// The outbound LINE sender seam. The worker calls pushMessage and maps the result
// to the DB state machine: `sent` -> mark_notification_sent; `retriable` (429/5xx)
// -> mark_notification_retry (schedules backoff); `permanent` (4xx) ->
// mark_notification_failed (no retry). The real api.line.me HTTP call lives behind
// this interface and is the ONLY deferred real-channel seam — see RealLineMessenger.

export interface LineMessage {
  type: string;
  [key: string]: unknown;
}

export interface PushMessageCommand {
  lineChannelId: string;
  accessToken: string;
  to: string;
  messages: LineMessage[];
}

export type PushMessageResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "retriable"; errorCode: string }
  | { status: "permanent"; errorCode: string };

export interface LineMessenger {
  pushMessage(command: PushMessageCommand): Promise<PushMessageResult>;
}

// Maps a non-sent result to the failure class that selects the DB mark function.
export function classifyPushFailure(
  result: Exclude<PushMessageResult, { status: "sent" }>,
): NotificationFailureClass {
  return result.status === "retriable" ? "retriable" : "permanent";
}

export type FakeMode = "sent" | "rate_limited" | "server_error" | "bad_request";

export interface FakeLineMessengerOptions {
  mode?: FakeMode;
}

// In-memory messenger for tests and local runs. Deterministic and configurable per
// failure mode; records every attempt (and every successful send) for assertion.
// No network, no env — this is what drives all four local gates.
export class FakeLineMessenger implements LineMessenger {
  private readonly mode: FakeMode;
  readonly attempts: PushMessageCommand[] = [];
  readonly sent: PushMessageCommand[] = [];

  constructor(options: FakeLineMessengerOptions = {}) {
    this.mode = options.mode ?? "sent";
  }

  async pushMessage(command: PushMessageCommand): Promise<PushMessageResult> {
    this.attempts.push(command);
    switch (this.mode) {
      case "rate_limited":
        return { status: "retriable", errorCode: "RATE_LIMITED" };
      case "server_error":
        return { status: "retriable", errorCode: "PROVIDER_UNAVAILABLE" };
      case "bad_request":
        return { status: "permanent", errorCode: "INVALID_REQUEST" };
      case "sent":
      default:
        this.sent.push(command);
        return { status: "sent", providerMessageId: `fake-${randomUUID()}` };
    }
  }
}

// DEFERRED REAL-CHANNEL SEAM. The interface is complete and this class typechecks so
// the factory and worker can reference it today, but the actual api.line.me push is
// intentionally NOT implemented — it is wired last, once the user provides live LINE
// credentials. Invoking it before that wiring is a programming error and throws.
export class RealLineMessenger implements LineMessenger {
  async pushMessage(command: PushMessageCommand): Promise<PushMessageResult> {
    // TODO(real-channel): POST https://api.line.me/v2/bot/message/push with
    //   Authorization: Bearer <command.accessToken>
    //   body { to: command.to, messages: command.messages }
    // Map HTTP 200 -> { status: 'sent', providerMessageId: x-line-request-id },
    //   429/5xx -> { status: 'retriable', errorCode }, other 4xx -> { status: 'permanent', errorCode }.
    void command;
    throw new Error("RealLineMessenger.pushMessage is not implemented (deferred real-channel seam).");
  }
}

// Factory: the real messenger is only selected when a live channel is explicitly
// configured. Until then everything runs against the fake, so the whole flow is
// exercised locally without any real LINE credentials.
export function createLineMessenger(): LineMessenger {
  if (process.env.LINE_CHANNEL_LIVE?.trim()) {
    return new RealLineMessenger();
  }
  return new FakeLineMessenger();
}
