"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchPilotInbox, fetchPilotSession, type PilotInboxItem } from "./api";
import { PilotBrand, PilotButton, PilotCard, PilotError, PilotLoading, PilotPage } from "./ui";

interface InboxState {
  status: "loading" | "ready" | "error";
  items: PilotInboxItem[];
}

const sourceLabels: Record<PilotInboxItem["source"], string> = {
  web: "公開表單",
};

const defaultNow = () => new Date();

export function formatWaitingTime(createdAt: string, now: Date): string {
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - Date.parse(createdAt)) / 60_000));
  if (elapsedMinutes < 1) return "剛剛收到";
  if (elapsedMinutes < 60) return `已等 ${elapsedMinutes} 分鐘`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `已等 ${hours} 小時`;
  return `已等 ${Math.floor(hours / 24)} 天`;
}

export function PilotInbox({ now = defaultNow }: { now?: () => Date }) {
  const [state, setState] = useState<InboxState>({ status: "loading", items: [] });

  const loadInbox = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading" }));
    try {
      const session = await fetchPilotSession();
      const activeMembership = session.memberships.find(
        (membership) => membership.status === "active",
      );
      if (!activeMembership) {
        throw new Error("尚未建立工作空間");
      }
      const page = await fetchPilotInbox(activeMembership.organizationId);
      setState({ status: "ready", items: page.data });
    } catch {
      setState({ status: "error", items: [] });
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  return (
    <PilotPage>
      <PilotBrand eyebrow="店內工作台" />
      {state.status === "loading" ? <PilotLoading label="正在載入接案匣" /> : null}
      {state.status === "error" ? (
        <PilotError
          title="接案匣暫時讀不到"
          description="需求仍保存在系統中。請確認網路後重新載入，不需要請客戶重送。"
          actionLabel="重新載入"
          onRetry={() => void loadInbox()}
        />
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
          <header className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-orange-deep">待你確認</p>
              <h1 className="mt-1 text-[28px] font-black tracking-[-0.04em] text-ink">接案匣</h1>
              <p className="mt-1 text-sm text-ink-3">公開表單送出後會保存在這裡。</p>
            </div>
            <span className="inline-flex h-11 min-w-11 items-center justify-center rounded-2xl bg-ink px-3 font-mono text-sm font-black text-white">
              {String(state.items.length).padStart(2, "0")}
              <span className="sr-only">筆新進件</span>
            </span>
          </header>

          {state.items.length === 0 ? (
            <PilotCard className="py-12 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-orange-soft text-2xl font-black text-orange-deep">
                0
              </div>
              <h2 className="mt-5 text-xl font-black text-ink">目前沒有新進件</h2>
              <p className="mt-2 text-sm leading-6 text-ink-3">
                把公開報修連結放進 LINE 圖文選單或直接傳給客戶即可開始收件。
              </p>
              <PilotButton variant="secondary" className="mt-5" onClick={() => void loadInbox()}>
                重新整理
              </PilotButton>
            </PilotCard>
          ) : (
            <div className="space-y-4">
              {state.items.map((item) => (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-[24px] border border-warm-border bg-white shadow-[0_14px_36px_rgba(74,45,20,0.07)]"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-warm-border bg-orange-soft/55 px-5 py-3">
                    <span className="text-xs font-bold text-orange-deep">
                      {sourceLabels[item.source]} · {item.referenceNo}
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[var(--warm-red)]">
                      {formatWaitingTime(item.createdAt, now())}
                    </span>
                  </div>
                  <div className="p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-bg-warm px-2.5 py-1 text-xs font-bold text-ink-2">
                        {item.category ?? "未分類"}
                      </span>
                      <span className="text-xs font-semibold text-ink-3">
                        {item.serviceName ?? "未指定服務"}
                      </span>
                    </div>
                    <h2 className="mt-3 text-lg font-black leading-6 tracking-tight text-ink">
                      {item.title}
                    </h2>
                    <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-ink-2">
                      {item.description}
                    </p>

                    <dl className="mt-4 space-y-2 rounded-2xl bg-[#fbf8f3] p-3.5 text-sm">
                      <div className="flex gap-2">
                        <dt className="w-14 shrink-0 font-semibold text-ink-3">聯絡人</dt>
                        <dd className="font-bold text-ink-2">{item.contactName}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-14 shrink-0 font-semibold text-ink-3">電話</dt>
                        <dd className="font-bold text-ink-2">
                          <a href={`tel:${item.contactPhone}`} className="text-orange-deep underline">
                            {item.contactPhone}
                          </a>
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

                    <div
                      role="status"
                      aria-label="案件處理狀態"
                      className="mt-4 rounded-xl border border-orange/20 bg-orange-soft/50 px-4 py-3 text-center text-xs font-bold leading-5 text-orange-deep"
                    >
                      已保存；案件整理與轉報價會在下一階段開放
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
    </PilotPage>
  );
}
