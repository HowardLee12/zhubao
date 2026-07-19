import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PilotOnboardingForm } from "./onboarding-form";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PilotOnboardingForm", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "onboarding-idempotency-key") });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates the store workspace and exposes its public intake link", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          data: {
            organization: {
              id: "20000000-0000-4000-8000-000000000001",
              name: "安心工程",
              industryTemplate: "cooling",
            },
            membership: {
              id: "30000000-0000-4000-8000-000000000001",
              organizationId: "20000000-0000-4000-8000-000000000001",
              role: "owner",
              status: "active",
            },
            publicIntakeUrl: "https://renoly.test/request/public-token",
          },
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<PilotOnboardingForm />);
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await user.type(screen.getByLabelText("店家名稱"), "安心工程");
    await user.type(screen.getByLabelText("網址代稱"), "anxin-service");
    await user.type(screen.getByLabelText("老闆顯示名稱"), "王老闆");
    await user.selectOptions(screen.getByLabelText("主要服務模板"), "cooling");
    await user.click(screen.getByRole("button", { name: "建立工作空間" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/organizations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Idempotency-Key": "onboarding-idempotency-key",
        }),
        body: JSON.stringify({
          name: "安心工程",
          slug: "anxin-service",
          ownerDisplayName: "王老闆",
          industryTemplate: "cooling",
          timezone: "Asia/Taipei",
          currency: "TWD",
        }),
      }),
    );

    expect(await screen.findByRole("heading", { name: "工作空間建立完成" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://renoly.test/request/public-token")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "複製公開報修連結" }));
    expect(writeText).toHaveBeenCalledWith("https://renoly.test/request/public-token");
    expect(screen.getByRole("status")).toHaveTextContent("連結已複製");
  });

  it("keeps the form editable and shows an API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            title: "網址代稱已被使用",
            detail: "請換一個網址代稱。",
            code: "SLUG_TAKEN",
          },
          409,
        ),
      ),
    );

    render(<PilotOnboardingForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("店家名稱"), "安心工程");
    await user.type(screen.getByLabelText("網址代稱"), "anxin-service");
    await user.type(screen.getByLabelText("老闆顯示名稱"), "王老闆");
    await user.click(screen.getByRole("button", { name: "建立工作空間" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("請換一個網址代稱");
    expect(screen.getByLabelText("店家名稱")).toHaveValue("安心工程");
    expect(screen.getByRole("button", { name: "建立工作空間" })).toBeEnabled();
  });
});
