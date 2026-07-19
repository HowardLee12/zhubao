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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PilotAppEntry", () => {
  beforeEach(() => {
    router.replace.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a signed-in owner without memberships to onboarding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ data: { user: sessionUser, memberships: [] } }),
      ),
    );

    render(<PilotAppEntry />);

    expect(screen.getByRole("status", { name: "正在確認工作空間" })).toBeInTheDocument();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/onboarding"));
  });

  it("sends an active member to the persisted inbox", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            user: sessionUser,
            memberships: [
              {
                id: "30000000-0000-4000-8000-000000000001",
                organizationId: "20000000-0000-4000-8000-000000000001",
                role: "owner",
                status: "active",
                displayName: "王老闆",
              },
            ],
          },
        }),
      ),
    );

    render(<PilotAppEntry />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/app/inbox"));
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
