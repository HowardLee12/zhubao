import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PilotSettings } from "./settings";

const organizationId = "20000000-0000-4000-8000-000000000001";
const settings = {
  organizationId,
  name: "安心工程",
  industryTemplate: "cooling",
  intakeHeadline: "描述需求，我們確認後聯絡您",
  privacyNotice: "資料只用於本次聯絡、估價與服務安排。",
  lockVersion: 3,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sessionResponse(): Response {
  return jsonResponse({
    data: {
      user: { id: crypto.randomUUID(), email: "owner@example.test" },
      memberships: [
        {
          id: crypto.randomUUID(),
          organizationId,
          organizationName: "安心工程",
          organizationSlug: "anxin-service",
          role: "owner",
          status: "active",
        },
      ],
      activeOrganizationId: organizationId,
    },
  });
}

describe("PilotSettings", () => {
  beforeEach(() => {
    let sequence = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `settings-key-${++sequence}`),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads the active organization's persisted public intake settings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: settings }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotSettings />);

    expect(screen.getByRole("status", { name: "正在載入店家設定" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "店家與公開表單" })).toBeInTheDocument();
    expect(screen.getByLabelText("店家名稱")).toHaveValue("安心工程");
    expect(screen.getByLabelText("公開表單標題")).toHaveValue(
      "描述需求，我們確認後聯絡您",
    );
    expect(screen.getByLabelText("個資蒐集說明")).toHaveValue(
      "資料只用於本次聯絡、估價與服務安排。",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v2/session", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v2/organizations/${organizationId}/settings`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("saves editable settings with the current lock version", async () => {
    const updated = {
      ...settings,
      name: "安心冷氣水電",
      intakeHeadline: "請描述現場狀況，我們會人工確認",
      lockVersion: 4,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: settings }))
      .mockResolvedValueOnce(jsonResponse({ data: updated }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<PilotSettings />);
    await screen.findByRole("heading", { name: "店家與公開表單" });
    await user.clear(screen.getByLabelText("店家名稱"));
    await user.type(screen.getByLabelText("店家名稱"), "安心冷氣水電");
    await user.clear(screen.getByLabelText("公開表單標題"));
    await user.type(
      screen.getByLabelText("公開表單標題"),
      "請描述現場狀況，我們會人工確認",
    );
    await user.click(screen.getByRole("button", { name: "儲存設定" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/v2/organizations/${organizationId}/settings`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "安心冷氣水電",
          intakeHeadline: "請描述現場狀況，我們會人工確認",
          privacyNotice: "資料只用於本次聯絡、估價與服務安排。",
          lockVersion: 3,
        }),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("設定已儲存");
  });

  it("requires destructive confirmation before rotating and exposes the new link once", async () => {
    const newPublicUrl = "https://renoly.test/request/new-public-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: settings }))
      .mockResolvedValueOnce(jsonResponse({ data: { publicIntakeUrl: newPublicUrl } }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<PilotSettings />);
    await screen.findByRole("heading", { name: "店家與公開表單" });
    await user.click(screen.getByRole("button", { name: "重新產生公開報修連結" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alertdialog", { name: "讓舊報修連結失效？" })).toHaveTextContent(
      "LINE 圖文選單或先前傳給客戶的舊連結會立即失效",
    );

    await user.click(screen.getByRole("button", { name: "確認使舊連結失效" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/v2/organizations/${organizationId}/public-intake-link/actions/rotate`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
      }),
    );
    expect(await screen.findByDisplayValue(newPublicUrl)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("舊連結已失效");

    await user.click(screen.getByRole("button", { name: "複製新連結" }));
    expect(writeText).toHaveBeenCalledWith(newPublicUrl);
    expect(screen.getByRole("status", { name: "複製結果" })).toHaveTextContent("新連結已複製");
  });

  it("shows a recoverable load error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ title: "暫時無法讀取" }, 503))
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: settings }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("店家設定暫時讀不到");
    await userEvent.click(screen.getByRole("button", { name: "重新載入" }));

    expect(await screen.findByRole("heading", { name: "店家與公開表單" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
