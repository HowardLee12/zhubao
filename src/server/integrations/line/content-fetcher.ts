// The inbound LINE content-download seam. When a customer sends an image, LINE does
// NOT put the bytes in the webhook — the worker must fetch them from the Messaging
// API content endpoint using the message id + the channel access token, then run the
// M2 photo pipeline (magic-byte + sha256 + dimension checks) before storing to the
// private bucket. The real api-data.line.me call lives behind this interface and is a
// deferred real-channel seam — see RealLineContentFetcher (mirrors RealLineMessenger).

export interface FetchContentCommand {
  lineChannelId: string;
  accessToken: string;
  lineMessageId: string;
}

export interface FetchedContent {
  bytes: Uint8Array;
  mimeType: string;
}

export interface LineContentFetcher {
  fetchContent(command: FetchContentCommand): Promise<FetchedContent>;
}

// A minimal valid 1x1 PNG. Deterministic fixed content so the fake exercises the
// image-download path (and the M2 magic-byte/sha256 checks that follow) without any
// network. base64 of the canonical 1x1 transparent PNG.
const FIXED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export interface FakeLineContentFetcherOptions {
  bytes?: Uint8Array;
  mimeType?: string;
}

// In-memory fetcher for tests and local runs. Returns fixed, deterministic bytes and
// records every call for assertion. No network, no env — this drives the local image
// aggregation path.
export class FakeLineContentFetcher implements LineContentFetcher {
  private readonly bytes: Uint8Array;
  private readonly mimeType: string;
  readonly calls: FetchContentCommand[] = [];

  constructor(options: FakeLineContentFetcherOptions = {}) {
    this.bytes = options.bytes ?? new Uint8Array(Buffer.from(FIXED_PNG_BASE64, "base64"));
    this.mimeType = options.mimeType ?? "image/png";
  }

  async fetchContent(command: FetchContentCommand): Promise<FetchedContent> {
    this.calls.push(command);
    // Return a fresh copy so a caller mutating the bytes cannot corrupt later calls.
    return { bytes: new Uint8Array(this.bytes), mimeType: this.mimeType };
  }
}

// DEFERRED REAL-CHANNEL SEAM. The interface is complete and this class typechecks so
// the worker/factory can reference it today, but the actual content download is
// intentionally NOT implemented — wired last with live LINE credentials. The endpoint
// is FIXED and server-controlled (no attacker-supplied URL), so there is no SSRF
// surface: only the message id is variable and it is path-encoded. Invoking it before
// wiring is a programming error and throws (mirrors RealLineMessenger).
export class RealLineContentFetcher implements LineContentFetcher {
  async fetchContent(command: FetchContentCommand): Promise<FetchedContent> {
    // TODO(real-channel): GET https://api-data.line.me/v2/bot/message/{messageId}/content
    //   Authorization: Bearer <command.accessToken>
    //   The host is a HARDCODED constant (never derived from user input) so this is
    //   SSRF-safe; encodeURIComponent(command.lineMessageId) is the only variable path
    //   segment. Read the response body as bytes + Content-Type, cap the size, and let
    //   the caller's M2 pipeline validate magic bytes / sha256 / dimensions before store.
    void command;
    throw new Error(
      "RealLineContentFetcher.fetchContent is not implemented (deferred real-channel seam).",
    );
  }
}

// Factory: the real fetcher is only selected when a live channel is explicitly
// configured, matching createLineMessenger's LINE_CHANNEL_LIVE gate. Until then the
// fake drives everything locally.
export function createLineContentFetcher(): LineContentFetcher {
  if (process.env.LINE_CHANNEL_LIVE?.trim()) {
    return new RealLineContentFetcher();
  }
  return new FakeLineContentFetcher();
}
