"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  fetchIntakeDrafts,
  fetchPilotInbox,
  fetchPilotSession,
  PilotApiError,
  type PilotInboxItem,
} from "./api";
import { toPilotInboxItemFromDraft } from "@/schemas/pilot-inbox";
import { PilotBrand, PilotButton, PilotCard, PilotError, PilotLoading, PilotPage } from "./ui";

type InboxTab = "pending" | "triaged" | "all";

const DISPATCH_ROLES = new Set(["owner", "admin", "dispatcher"]);

interface TabDefinition {
  id: InboxTab;
  label: string;
  status?: string;
  emptyHeading: string;
  emptyBody: string;
}

const TABS: readonly TabDefinition[] = [
  {
    id: "pending",
    label: "待處理",
    status: "new",
    emptyHeading: "目前沒有待處理的進件",
    emptyBody: "把公開報修連結放進 LINE 圖文選單或直接傳給客戶即可開始收件。",
  },
  {
    id: "triaged",
    label: "已分流",
    status: "triaged",
    emptyHeading: "目前沒有已分流的案件",
    emptyBody: "分流後的案件會顯示在這裡，方便追蹤負責人與後續處理。",
  },
  {
    id: "all",
    label: "全部",
    emptyHeading: "目前沒有任何進件",
    emptyBody: "所有進件（含已處理、已轉換）都會出現在這個清單。",
  },
];

const statusLabels: Record<PilotInboxItem["status"], string> = {
  new: "待處理",
  triaged: "已分流",
  quoting: "報價中",
  quoted: "已報價",
  converted: "已轉換",
  declined: "不適用",
  cancelled: "已取消",
};

const sourceLabels: Record<PilotInboxItem["source"], string> = {
  web: "公開表單",
  line: "LINE",
};

// LINE draft rows link to the dedicated review screen (待確認 · LINE), where a human
// confirms the AI/manual draft into a service_request; web rows go straight to the
// triage detail. A draft carries draftId; web rows use the service_request id.
function inboxItemHref(item: PilotInboxItem): string {
  return item.source === "line" && item.draftId
    ? `/app/inbox/drafts/${item.draftId}`
    : `/app/inbox/${item.id}`;
}

interface LoadedPage {
  items: PilotInboxItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

type LoadStatus = "loading" | "ready" | "error" | "restricted";

interface InboxState {
  status: LoadStatus;
  tab: InboxTab;
  organizationId: string | null;
  page: LoadedPage;
  loadingMore: boolean;
}

const emptyPage: LoadedPage = { items: [], nextCursor: null, hasMore: false };

const defaultNow = () => new Date();

export function formatWaitingTime(createdAt: string, now: Date): string {
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - Date.parse(createdAt)) / 60_000));
  if (elapsedMinutes < 1) return "剛剛收到";
  if (elapsedMinutes < 60) return `已等 ${elapsedMinutes} 分鐘`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `已等 ${hours} 小時`;
  return `已等 ${Math.floor(hours / 24)} 天`;
}

function tabDefinition(tab: InboxTab): TabDefinition {
  return TABS.find((candidate) => candidate.id === tab) ?? TABS[0];
}

export function PilotInbox({ now = defaultNow }: Readonly<{ now?: () => Date }>) {
  const [state, setState] = useState<InboxState>({
    status: "loading",
    tab: "pending",
    organizationId: null,
    page: emptyPage,
    loadingMore: false,
  });

  // Loads a tab's first page. Session resolution (which member/org is active) is
  // done once here when no organization is bound yet; subsequent tab switches
  // reuse the already-resolved organization so we never re-hit the session RPC.
  const loadTab = useCallback(async (tab: InboxTab, knownOrganizationId: string | null) => {
    setState((current) => ({ ...current, status: "loading", tab, page: emptyPage }));
    try {
      let organizationId = knownOrganizationId;
      if (!organizationId) {
        const session = await fetchPilotSession();
        const activeMembership = session.memberships.find(
          (membership) => membership.status === "active",
        );
        if (!activeMembership) {
          throw new Error("尚未建立工作空間");
        }
        if (!DISPATCH_ROLES.has(activeMembership.role)) {
          setState((current) => ({
            ...current,
            status: "restricted",
            tab,
            organizationId: activeMembership.organizationId,
            page: emptyPage,
          }));
          return;
        }
        organizationId = activeMembership.organizationId;
      }

      // The pending tab also surfaces LINE intake drafts (待確認 · LINE) so a human
      // confirms them into service requests. Draft loading is best-effort: a failure
      // there never hides the web requests (and never blocks intake) — the drafts
      // simply don't appear this pass. Web-only tabs (triaged/all) skip the draft
      // fetch entirely.
      const includeDrafts = tab === "pending";
      const [page, draftItems] = await Promise.all([
        fetchPilotInbox(organizationId, { status: tabDefinition(tab).status }),
        includeDrafts
          ? fetchIntakeDrafts(organizationId, { status: "pending_review" })
              .then((drafts) => drafts.map((draft) => toPilotInboxItemFromDraft(draft)))
              .catch(() => [] as PilotInboxItem[])
          : Promise.resolve([] as PilotInboxItem[]),
      ]);
      // Drafts first (newest intake awaiting confirmation sits on top), then the
      // web service requests for this tab.
      const merged = [...draftItems, ...page.data];
      setState((current) => ({
        ...current,
        status: "ready",
        tab,
        organizationId,
        page: { items: merged, nextCursor: page.meta.nextCursor, hasMore: page.meta.hasMore },
      }));
    } catch (error) {
      if (error instanceof PilotApiError && error.status === 403) {
        setState((current) => ({ ...current, status: "restricted", tab, page: emptyPage }));
        return;
      }
      setState((current) => ({ ...current, status: "error", tab, page: emptyPage }));
    }
  }, []);

  const loadMore = useCallback(
    async (organizationId: string, tab: InboxTab, cursor: string) => {
      setState((current) => ({ ...current, loadingMore: true }));
      try {
        const page = await fetchPilotInbox(organizationId, {
          status: tabDefinition(tab).status,
          cursor,
        });
        setState((current) => ({
          ...current,
          loadingMore: false,
          page: {
            items: [...current.page.items, ...page.data],
            nextCursor: page.meta.nextCursor,
            hasMore: page.meta.hasMore,
          },
        }));
      } catch {
        setState((current) => ({ ...current, loadingMore: false }));
      }
    },
    [],
  );

  useEffect(() => {
    void loadTab("pending", null);
  }, [loadTab]);

  const activeTab = tabDefinition(state.tab);

  return (
    <PilotPage>
      <PilotBrand eyebrow="店內工作台" />
      {state.status === "loading" ? <PilotLoading label="正在載入接案匣" /> : null}
      {state.status === "error" ? (
        <PilotError
          title="接案匣暫時讀不到"
          description="需求仍保存在系統中。請確認網路後重新載入，不需要請客戶重送。"
          actionLabel="重新載入"
          onRetry={() => void loadTab(state.tab, state.organizationId)}
        />
      ) : null}
      {state.status === "restricted" ? (
        <PilotCard className="py-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-soft text-2xl font-black text-orange-deep">
            ！
          </div>
          <h1 className="mt-4 text-xl font-black tracking-tight text-ink">沒有接案匣權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            接案匣只開放給有派工權限的成員（負責人、管理員或派工員）。若你需要處理進件，請聯絡店家管理員調整你的角色。
          </p>
          <Link
            href="/app/my-work-orders"
            className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-orange px-4 text-sm font-bold text-white shadow-[0_10px_25px_rgba(226,105,31,0.22)] transition hover:bg-orange-deep"
          >
            前往我的工單 →
          </Link>
        </PilotCard>
      ) : null}
      {state.status === "ready" ? (
        <>
          <nav aria-label="工作台功能" className="mb-4 flex justify-end">
            <a
              href="/app/settings"
              className="inline-flex min-h-10 items-center rounded-xl border border-warm-border-strong bg-white px-3.5 text-xs font-bold text-ink-2"
            >
              店家設定
            </a>
          </nav>
          <header className="mb-5">
            <p className="text-xs font-bold text-orange-deep">待你確認</p>
            <h1 className="mt-1 text-[28px] font-black tracking-[-0.04em] text-ink">接案匣</h1>
            <p className="mt-1 text-sm text-ink-3">公開表單送出後會保存在這裡。</p>
          </header>

          <div
            role="tablist"
            aria-label="接案匣分類"
            className="mb-5 flex gap-1 rounded-2xl border border-warm-border bg-white p-1"
          >
            {TABS.map((tab) => {
              const selected = tab.id === state.tab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`min-h-10 flex-1 rounded-xl px-3 text-sm font-bold transition ${
                    selected
                      ? "bg-orange text-white shadow-[0_8px_20px_rgba(226,105,31,0.2)]"
                      : "text-ink-3 hover:bg-orange-soft/50"
                  }`}
                  onClick={() => {
                    if (!selected) void loadTab(tab.id, state.organizationId);
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {state.page.items.length === 0 ? (
            <PilotCard className="py-12 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-orange-soft text-2xl font-black text-orange-deep">
                0
              </div>
              <h2 className="mt-5 text-xl font-black text-ink">{activeTab.emptyHeading}</h2>
              <p className="mt-2 text-sm leading-6 text-ink-3">{activeTab.emptyBody}</p>
              <PilotButton
                variant="secondary"
                className="mt-5"
                onClick={() => void loadTab(state.tab, state.organizationId)}
              >
                重新整理
              </PilotButton>
            </PilotCard>
          ) : (
            <div className="space-y-4">
              {state.page.items.map((item) => (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-[24px] border border-warm-border bg-white shadow-[0_14px_36px_rgba(74,45,20,0.07)]"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-warm-border bg-orange-soft/55 px-5 py-3">
                    <span className="text-xs font-bold text-orange-deep">
                      {sourceLabels[item.source]} · {item.referenceNo}
                    </span>
                    <div className="flex items-center gap-2">
                      {item.source === "line" ? (
                        <span className="rounded-full bg-orange px-2.5 py-1 text-[11px] font-bold text-white">
                          待確認 · LINE
                        </span>
                      ) : (
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-ink-2">
                          {statusLabels[item.status]}
                        </span>
                      )}
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[var(--warm-red)]">
                        {formatWaitingTime(item.createdAt, now())}
                      </span>
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.source === "line" ? (
                        <>
                          <span className="rounded-full bg-bg-warm px-2.5 py-1 text-xs font-bold text-ink-2">
                            {item.origin === "manual" ? "AI 整理失敗" : "AI 已整理"}
                          </span>
                          {typeof item.confidence === "number" ? (
                            <span className="text-xs font-semibold text-ink-3">
                              信心 {Math.round(item.confidence * 100)}%
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <span className="rounded-full bg-bg-warm px-2.5 py-1 text-xs font-bold text-ink-2">
                            {item.category ?? "未分類"}
                          </span>
                          <span className="text-xs font-semibold text-ink-3">
                            {item.serviceName ?? "未指定服務"}
                          </span>
                        </>
                      )}
                    </div>
                    <h2 className="mt-3 text-lg font-black leading-6 tracking-tight text-ink">
                      {item.title}
                    </h2>
                    <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-ink-2">
                      {item.description}
                    </p>

                    {item.source === "line" ? (
                      <dl className="mt-4 space-y-2 rounded-2xl bg-[#fbf8f3] p-3.5 text-sm">
                        <div className="flex gap-2">
                          <dt className="w-16 shrink-0 font-semibold text-ink-3">LINE 用戶</dt>
                          <dd className="break-all font-bold text-ink-2">{item.contactName}</dd>
                        </div>
                      </dl>
                    ) : (
                      <dl className="mt-4 space-y-2 rounded-2xl bg-[#fbf8f3] p-3.5 text-sm">
                        <div className="flex gap-2">
                          <dt className="w-14 shrink-0 font-semibold text-ink-3">聯絡人</dt>
                          <dd className="font-bold text-ink-2">{item.contactName}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-14 shrink-0 font-semibold text-ink-3">電話</dt>
                          <dd className="font-bold text-ink-2">
                            {item.contactPhone ? (
                              <a
                                href={`tel:${item.contactPhone}`}
                                className="text-orange-deep underline"
                              >
                                {item.contactPhone}
                              </a>
                            ) : (
                              <span className="text-ink-3">未提供</span>
                            )}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-14 shrink-0 font-semibold text-ink-3">地址</dt>
                          <dd className="text-ink-2">{item.address ?? "尚未提供"}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-14 shrink-0 font-semibold text-ink-3">附件</dt>
                          <dd className="text-ink-2">{item.photoCount} 張照片</dd>
                        </div>
                      </dl>
                    )}

                    <a
                      href={inboxItemHref(item)}
                      className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange px-4 text-sm font-bold text-white shadow-[0_10px_25px_rgba(226,105,31,0.22)] transition hover:bg-orange-deep"
                    >
                      {item.source === "line" ? "確認 LINE 進件" : "查看並整理進件"}
                    </a>
                  </div>
                </article>
              ))}

              {state.page.hasMore && state.organizationId && state.page.nextCursor ? (
                <PilotButton
                  variant="secondary"
                  className="w-full"
                  disabled={state.loadingMore}
                  onClick={() => {
                    if (state.organizationId && state.page.nextCursor) {
                      void loadMore(state.organizationId, state.tab, state.page.nextCursor);
                    }
                  }}
                >
                  {state.loadingMore ? "載入中…" : "載入更多"}
                </PilotButton>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </PilotPage>
  );
}
