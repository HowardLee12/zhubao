"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { fetchPilotSession, type PilotMembership } from "./api";
import {
  cancelNotification,
  fetchNotifications,
  retryNotification,
  type NotificationView,
} from "./line-notifications-api";
import {
  PilotBrand,
  PilotButton,
  PilotCard,
  PilotError,
  PilotInlineNotice,
  PilotLoading,
  PilotPage,
} from "./ui";
import { MANAGER_ROLES } from "./work-order-format";

type LoadState = "loading" | "ready" | "error" | "restricted";

const STATUS_LABELS: Record<NotificationView["status"], string> = {
  pending: "待發送",
  processing: "發送中",
  sent: "已送出",
  delivered: "已送達",
  failed: "失敗",
  cancelled: "已取消",
};

const STATUS_TONE: Record<NotificationView["status"], string> = {
  pending: "bg-orange-soft text-orange-deep",
  processing: "bg-orange-soft text-orange-deep",
  sent: "bg-[var(--warm-green-soft)] text-[var(--warm-green)]",
  delivered: "bg-[var(--warm-green-soft)] text-[var(--warm-green)]",
  failed: "bg-[var(--warm-red-soft)] text-[var(--warm-red)]",
  cancelled: "bg-warm-border text-ink-3",
};

export function NotificationsOutbox() {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async (orgId: string) => {
    const page = await fetchNotifications(orgId, { pageSize: 50 });
    setItems(page.data);
  }, []);

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    void fetchPilotSession()
      .then(async (session) => {
        const membership: PilotMembership | undefined = session.memberships.find(
          (m) => m.status === "active",
        );
        if (!membership) throw new Error("尚未建立工作空間");
        if (!MANAGER_ROLES.has(membership.role)) {
          if (active) setLoadState("restricted");
          return;
        }
        await reload(membership.organizationId);
        if (!active) return;
        setOrganizationId(membership.organizationId);
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [attempt, reload]);

  const doRetry = async (id: string) => {
    if (!organizationId) return;
    setBusyId(id);
    setActionError(null);
    try {
      await retryNotification(organizationId, id);
      await reload(organizationId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "重送失敗，請稍後再試。");
    } finally {
      setBusyId(null);
    }
  };

  const doCancel = async (id: string) => {
    if (!organizationId) return;
    setBusyId(id);
    setActionError(null);
    try {
      await cancelNotification(organizationId, id);
      await reload(organizationId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "取消失敗，請稍後再試。");
    } finally {
      setBusyId(null);
    }
  };

  if (loadState === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="通知發送紀錄" />
        <PilotLoading label="正在載入通知紀錄" />
      </PilotPage>
    );
  }

  if (loadState === "restricted") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="通知發送紀錄" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">你沒有檢視權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            通知發送紀錄僅開放給負責人、管理員與派工人員。
          </p>
        </PilotCard>
      </PilotPage>
    );
  }

  if (loadState === "error") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="通知發送紀錄" />
        <PilotError
          title="通知紀錄讀不到"
          description="連線可能暫時中斷，資料不會因此改變。請重新載入。"
          actionLabel="重新載入"
          onRetry={() => setAttempt((c) => c + 1)}
        />
      </PilotPage>
    );
  }

  return (
    <PilotPage>
      <PilotBrand eyebrow="通知發送紀錄" />
      <Link href="/app/settings" className="mb-4 inline-flex min-h-10 items-center text-sm font-bold text-orange-deep">
        ← 回店家設定
      </Link>
      <header className="mb-5">
        <h1 className="text-[28px] font-black tracking-[-0.04em] text-ink">LINE 通知發送紀錄</h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          這裡是自動 LINE 通知的實際發送狀態。失敗的通知可以手動重送。
        </p>
      </header>

      {actionError ? (
        <div className="mb-4">
          <PilotInlineNotice>{actionError}</PilotInlineNotice>
        </div>
      ) : null}

      {items.length === 0 ? (
        <PilotCard className="py-10 text-center">
          <p className="text-sm leading-6 text-ink-3">目前沒有任何 LINE 通知紀錄。</p>
        </PilotCard>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <PilotCard>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-ink">{templateLabel(item.templateKey)}</p>
                    <p className="mt-0.5 font-mono text-xs text-ink-3">{item.channel}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${STATUS_TONE[item.status]}`}
                  >
                    {STATUS_LABELS[item.status]}
                  </span>
                </div>
                <dl className="mt-3 space-y-1 text-xs text-ink-3">
                  <div className="flex justify-between gap-3">
                    <dt>嘗試次數</dt>
                    <dd className="text-ink-2">
                      {item.attemptCount} / {item.maxAttempts}
                    </dd>
                  </div>
                  {item.lastErrorCode ? (
                    <div className="flex justify-between gap-3">
                      <dt>最後錯誤</dt>
                      <dd className="font-mono text-[var(--warm-red)]">{item.lastErrorCode}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <dt>建立時間</dt>
                    <dd className="text-ink-2">{item.createdAt}</dd>
                  </div>
                </dl>
                {item.status === "failed" || item.status === "pending" ? (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <PilotButton
                      type="button"
                      variant="secondary"
                      disabled={item.status !== "failed" || busyId === item.id}
                      onClick={() => void doRetry(item.id)}
                    >
                      {busyId === item.id ? "處理中…" : "重送"}
                    </PilotButton>
                    <PilotButton
                      type="button"
                      variant="danger"
                      disabled={busyId === item.id}
                      onClick={() => void doCancel(item.id)}
                    >
                      取消
                    </PilotButton>
                  </div>
                ) : null}
              </PilotCard>
            </li>
          ))}
        </ul>
      )}
    </PilotPage>
  );
}

const TEMPLATE_LABELS: Record<string, string> = {
  received: "已受理通知",
  quote_sent: "報價送出通知",
  appointment_confirmed: "預約確認通知",
  en_route: "師傅出發通知",
  completed: "完工通知",
  payment_reminder: "付款提醒",
};

function templateLabel(key: string): string {
  return TEMPLATE_LABELS[key] ?? key;
}
