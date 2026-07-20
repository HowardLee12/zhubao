import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PilotAppEntry } from "./app-entry";

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const sessionUser = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
  displayName: "王老闆",
};

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    role: "owner",
    status: "active",
    displayName: "王老闆",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubSession(memberships: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      jsonResponse({ data: { user: sessionUser, memberships } }),
    ),
  );
}

describe("PilotAppEntry", () => {
  beforeEach(() => {
    router.replace.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a signed-in user without memberships to onboarding", async () => {
    stubSession([]);

    render(<PilotAppEntry />);

    expect(screen.getByRole("status", { name: "正在確認工作空間" })).toBeInTheDocument();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/onboarding"));
  });

  it("sends an active technician to their own today screen", async () => {
    stubSession([membership({ role: "technician" })]);

    render(<PilotAppEntry />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/today"));
  });

  it("renders a manager hub instead of redirecting for an owner", async () => {
    stubSession([membership({ role: "owner" })]);

    render(<PilotAppEntry />);

    expect(await screen.findByRole("heading", { name: /工作台/ })).toBeInTheDocument();
    // The manager stays on /app; the hub is rendered rather than a redirect.
    expect(router.replace).not.toHaveBeenCalled();

    const inbox = screen.getByRole("link", { name: /接案匣/ });
    expect(inbox).toHaveAttribute("href", "/app/inbox");
    expect(screen.getByRole("link", { name: /排程/ })).toHaveAttribute("href", "/app/schedule");
    expect(screen.getByRole("link", { name: /成員/ })).toHaveAttribute(
      "href",
      "/app/settings/team",
    );
    expect(screen.getByRole("link", { name: /設定/ })).toHaveAttribute("href", "/app/settings");
  });

  it("renders the hub for a dispatcher too", async () => {
    stubSession([membership({ role: "dispatcher" })]);

    render(<PilotAppEntry />);

    expect(await screen.findByRole("link", { name: /接案匣/ })).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows a recoverable error and retries session resolution", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ title: "暫時無法讀取" }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: { user: sessionUser, memberships: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotAppEntry />);

    expect(await screen.findByRole("alert")).toHaveTextContent("無法確認登入狀態");
    await userEvent.click(screen.getByRole("button", { name: "再試一次" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/onboarding"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
