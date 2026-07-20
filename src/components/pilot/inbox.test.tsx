import { render, screen, waitFor, within } from "@testing-library/react";
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

function sessionResponse(role = "owner"): Response {
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
          role,
          status: "active",
          displayName: "王老闆",
        },
      ],
    },
  });
}

function inboxItem(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function inboxPage(items: unknown[], meta: { nextCursor: string | null; hasMore: boolean }) {
  return jsonResponse({ data: items, meta });
}

function draftListResponse(items: unknown[] = []) {
  return jsonResponse({ data: items });
}

function draftItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "90000000-0000-4000-8000-000000000001",
    conversationId: "a0000000-0000-4000-8000-000000000001",
    status: "pending_review",
    origin: "ai",
    source: "line",
    title: "LINE 進件（AI 摘要）",
    summary: "冷氣不冷想約人來看",
    confidence: 0.82,
    missingFields: ["contactPhone"],
    lineUserId: "Uline-alpha-customer-0001",
    messageCount: 2,
    lastMessageAt: "2026-07-18T02:00:00.000Z",
    lockVersion: 1,
    createdAt: "2026-07-18T02:05:00.000Z",
    updatedAt: "2026-07-18T02:05:00.000Z",
    ...overrides,
  };
}

describe("PilotInbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the pending tab and links each card to the triage detail screen", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(inboxPage([inboxItem()], { nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(draftListResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotInbox now={() => new Date("2026-07-16T02:00:00.000Z")} />);

    expect(screen.getByRole("status", { name: "正在載入接案匣" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "接案匣" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "兩台分離式冷氣有異味" })).toBeInTheDocument();
    expect(screen.getByText("林太太")).toBeInTheDocument();
    expect(screen.getByText("已等 18 分鐘")).toBeInTheDocument();

    // The old "next stage" placeholder banner is gone; a real triage link exists.
    expect(
      screen.queryByText(/案件整理與轉報價會在下一階段開放/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看並整理/ })).toHaveAttribute(
      "href",
      "/app/inbox/80000000-0000-4000-8000-000000000001",
    );

    // The pending tab requests status=new.
    const inboxCall = fetchMock.mock.calls[1][0] as string;
    expect(inboxCall).toContain("status=new");
  });

  it("switches tabs and refetches with the tab status filter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(inboxPage([inboxItem()], { nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(draftListResponse())
      .mockResolvedValueOnce(
        inboxPage(
          [inboxItem({ id: "80000000-0000-4000-8000-000000000002", status: "triaged", title: "已分流案件" })],
          { nextCursor: null, hasMore: false },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotInbox />);

    await screen.findByRole("heading", { name: "接案匣" });
    await userEvent.click(screen.getByRole("tab", { name: /已分流/ }));

    expect(await screen.findByRole("heading", { name: "已分流案件" })).toBeInTheDocument();
    // The triaged tab is web-only (no draft fetch), so the tab request is call 3.
    const triagedCall = fetchMock.mock.calls[3][0] as string;
    expect(triagedCall).toContain("status=triaged");
  });

  it("loads more using the returned cursor and appends the next page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        inboxPage([inboxItem({ title: "第一頁案件" })], {
          nextCursor: "cursor-token-abc",
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(draftListResponse())
      .mockResolvedValueOnce(
        inboxPage(
          [inboxItem({ id: "80000000-0000-4000-8000-000000000009", title: "第二頁案件" })],
          { nextCursor: null, hasMore: false },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotInbox />);

    expect(await screen.findByRole("heading", { name: "第一頁案件" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "載入更多" }));

    expect(await screen.findByRole("heading", { name: "第二頁案件" })).toBeInTheDocument();
    // Both pages remain visible (append, not replace).
    expect(screen.getByRole("heading", { name: "第一頁案件" })).toBeInTheDocument();
    // Load-more is web-only (no draft refetch), so it is call 3.
    const loadMoreCall = fetchMock.mock.calls[3][0] as string;
    expect(loadMoreCall).toContain("cursor=cursor-token-abc");
    // No more pages -> the button disappears.
    expect(screen.queryByRole("button", { name: "載入更多" })).not.toBeInTheDocument();
  });

  it("shows a per-tab empty state when no requests exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(inboxPage([], { nextCursor: null, hasMore: false }))
        .mockResolvedValueOnce(draftListResponse()),
    );

    render(<PilotInbox />);

    expect(await screen.findByRole("heading", { name: "目前沒有待處理的進件" })).toBeInTheDocument();
  });

  it("shows an error state and retries the whole authenticated load", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ title: "暫時無法讀取" }, 503))
      .mockResolvedValueOnce(draftListResponse())
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(inboxPage([], { nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(draftListResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotInbox />);

    expect(await screen.findByRole("alert")).toHaveTextContent("接案匣暫時讀不到");
    await userEvent.click(screen.getByRole("button", { name: "重新載入" }));

    expect(await screen.findByRole("heading", { name: "目前沒有待處理的進件" })).toBeInTheDocument();
    // Failing attempt (session + inbox + drafts) then retry (session + inbox + drafts).
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
  });

  it("shows a restricted view to technicians without dispatch access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(sessionResponse("technician")),
    );

    render(<PilotInbox />);

    expect(await screen.findByRole("heading", { name: "沒有接案匣權限" })).toBeInTheDocument();
    expect(
      screen.getByText(/派工權限/),
    ).toBeInTheDocument();
  });

  it("shows a 403 restricted view when the inbox API forbids access", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(jsonResponse({ title: "沒有權限" }, 403))
        .mockResolvedValueOnce(draftListResponse()),
    );

    render(<PilotInbox />);

    expect(await screen.findByRole("heading", { name: "沒有接案匣權限" })).toBeInTheDocument();
  });

  it("renders a status pill on triaged cards in the all tab", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(inboxPage([inboxItem()], { nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(draftListResponse())
      .mockResolvedValueOnce(
        inboxPage(
          [
            inboxItem({ status: "new", title: "待處理案件" }),
            inboxItem({ id: "80000000-0000-4000-8000-000000000003", status: "converted", title: "已轉換案件" }),
          ],
          { nextCursor: null, hasMore: false },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotInbox />);

    await screen.findByRole("heading", { name: "接案匣" });
    await userEvent.click(screen.getByRole("tab", { name: /全部/ }));

    const convertedCard = (await screen.findByRole("heading", { name: "已轉換案件" })).closest(
      "article",
    ) as HTMLElement;
    expect(within(convertedCard).getByText("已轉換")).toBeInTheDocument();
    // The all tab is web-only (no draft fetch), so it is call 3.
    const allCall = fetchMock.mock.calls[3][0] as string;
    expect(allCall).not.toContain("status=");
  });

  it("shows a 待確認 · LINE badge on draft cards and links to the draft-review screen", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(inboxPage([], { nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(draftListResponse([draftItem({ title: "LINE 冷氣進件" })]));
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotInbox />);

    const draftCard = (await screen.findByRole("heading", { name: "LINE 冷氣進件" })).closest(
      "article",
    ) as HTMLElement;
    // The badge marks it as a LINE draft awaiting human confirmation.
    expect(within(draftCard).getByText("待確認 · LINE")).toBeInTheDocument();
    // Per-field confidence surfaces on the card.
    expect(within(draftCard).getByText(/信心 82%/)).toBeInTheDocument();
    // The card links to the dedicated draft-review screen keyed by draft id.
    expect(within(draftCard).getByRole("link", { name: /確認 LINE 進件/ })).toHaveAttribute(
      "href",
      "/app/inbox/drafts/90000000-0000-4000-8000-000000000001",
    );
    // The draft fetch asked for pending_review drafts.
    const draftCall = fetchMock.mock.calls[2][0] as string;
    expect(draftCall).toContain("/intake-drafts");
    expect(draftCall).toContain("status=pending_review");
  });

  it("marks a degraded (manual) draft honestly and keeps it confirmable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(inboxPage([], { nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(
        draftListResponse([
          draftItem({
            title: "LINE 手動進件",
            origin: "manual",
            summary: "馬桶漏水",
            confidence: null,
          }),
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotInbox />);

    const draftCard = (await screen.findByRole("heading", { name: "LINE 手動進件" })).closest(
      "article",
    ) as HTMLElement;
    expect(within(draftCard).getByText("AI 整理失敗")).toBeInTheDocument();
    expect(within(draftCard).getByText("待確認 · LINE")).toBeInTheDocument();
  });

  it("renders web requests and LINE drafts together in the pending tab", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        inboxPage([inboxItem({ title: "公開表單進件" })], { nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(draftListResponse([draftItem({ title: "LINE 進件卡片" })]));
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotInbox />);

    expect(await screen.findByRole("heading", { name: "LINE 進件卡片" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "公開表單進件" })).toBeInTheDocument();
  });

  it("still shows web requests when the drafts fetch fails (intake never blocked)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        inboxPage([inboxItem({ title: "公開表單進件" })], { nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(jsonResponse({ title: "drafts down" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotInbox />);

    expect(await screen.findByRole("heading", { name: "公開表單進件" })).toBeInTheDocument();
  });
});
