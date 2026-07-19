import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PilotInbox } from "./inbox";

const organizationId = "20000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sessionResponse(): Response {
  return jsonResponse({
    data: {
      user: {
        id: "10000000-0000-4000-8000-000000000001",
        email: "owner@example.test",
        displayName: "王老闆",
      },
      memberships: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          organizationId,
          role: "owner",
          status: "active",
          displayName: "王老闆",
        },
      ],
    },
  });
}

describe("PilotInbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the active organization and renders persisted new intakes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "80000000-0000-4000-8000-000000000001",
              referenceNo: "R-2026-0012",
              source: "web",
              status: "new",
              priority: "normal",
              serviceName: "分離式冷氣清洗",
              category: "冷氣",
              title: "兩台分離式冷氣有異味",
              description: "希望週六上午到府",
              contactName: "林太太",
              contactPhone: "+886912345678",
              address: "台北市松山區民生東路四段 88 號",
              photoCount: 3,
              preferredWindows: [],
              createdAt: "2026-07-16T01:42:00.000Z",
              updatedAt: "2026-07-16T01:42:00.000Z",
            },
          ],
          meta: { nextCursor: null, hasMore: false },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotInbox now={() => new Date("2026-07-16T02:00:00.000Z")} />);

    expect(screen.getByRole("status", { name: "正在載入接案匣" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "接案匣" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "店家設定" })).toHaveAttribute(
      "href",
      "/app/settings",
    );
    expect(screen.getByRole("heading", { name: "兩台分離式冷氣有異味" })).toBeInTheDocument();
    expect(screen.getByText("分離式冷氣清洗")).toBeInTheDocument();
    expect(screen.getByText("林太太")).toBeInTheDocument();
    expect(screen.getByText("台北市松山區民生東路四段 88 號")).toBeInTheDocument();
    expect(screen.getByText("3 張照片")).toBeInTheDocument();
    expect(screen.getByText("已等 18 分鐘")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "案件處理狀態" })).toHaveTextContent(
      "案件整理與轉報價會在下一階段開放",
    );
    expect(screen.queryByRole("link", { name: "查看並整理進件" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v2/session", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v2/organizations/${organizationId}/service-requests?status=new&limit=50`,
      expect.any(Object),
    );
  });

  it("shows an empty state when no new intake exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(
          jsonResponse({ data: [], meta: { nextCursor: null, hasMore: false } }),
        ),
    );

    render(<PilotInbox />);

    expect(await screen.findByRole("heading", { name: "目前沒有新進件" })).toBeInTheDocument();
    expect(screen.getByText("把公開報修連結放進 LINE 圖文選單或直接傳給客戶即可開始收件。")).toBeInTheDocument();
  });

  it("shows an error state and retries the whole authenticated load", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ title: "暫時無法讀取" }, 503))
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        jsonResponse({ data: [], meta: { nextCursor: null, hasMore: false } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotInbox />);

    expect(await screen.findByRole("alert")).toHaveTextContent("接案匣暫時讀不到");
    await userEvent.click(screen.getByRole("button", { name: "重新載入" }));

    expect(await screen.findByRole("heading", { name: "目前沒有新進件" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });
});
