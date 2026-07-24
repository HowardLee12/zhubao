import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PilotPublicQuoteFromFragment } from "./public-quote-fragment";

const mocks = vi.hoisted(() => ({ PilotPublicQuote: vi.fn() }));

vi.mock("./public-quote", () => ({
  PilotPublicQuote: ({ token }: { token: string }) => {
    mocks.PilotPublicQuote(token);
    return <div>token:{token}</div>;
  },
}));

describe("PilotPublicQuoteFromFragment", () => {
  afterEach(() => {
    globalThis.history.replaceState(null, "", "/");
    vi.clearAllMocks();
  });

  it("reads a valid capability from the fragment rather than the request pathname", async () => {
    const token = "x".repeat(43);
    globalThis.history.replaceState(null, "", `/public/quotes#${token}`);
    render(<PilotPublicQuoteFromFragment />);

    expect(await screen.findByText(`token:${token}`)).toBeInTheDocument();
    expect(globalThis.location.pathname).toBe("/public/quotes");
    expect(mocks.PilotPublicQuote).toHaveBeenCalledWith(token);
  });

  it("uses the same unavailable flow when the fragment is missing or malformed", async () => {
    globalThis.history.replaceState(null, "", "/public/quotes#short");
    render(<PilotPublicQuoteFromFragment />);

    expect(await screen.findByText("token:invalid")).toBeInTheDocument();
  });
});
