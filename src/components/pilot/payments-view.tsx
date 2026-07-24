"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchPilotSession, type PilotMembership } from "./api";
import {
  fetchPaymentMilestones,
  invoicePaymentMilestone,
  markPaymentMilestonePaid,
  reversePaymentMilestone,
  waivePaymentMilestone,
  type PaymentMilestone,
  type PaymentMilestoneStatus,
} from "./operations-api";
import {
  daysOverdue,
  formatLocalDate,
  formatTwd,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
} from "./operations-format";
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

// The visible payments tabs. 部分付款 is an honest "not yet supported" placeholder
// — partial payment needs a payment_allocation table and is deliberately OUT of
// scope for the pilot (recorded in ADR 0007). It keeps the tab so the promise gap
// is explicit rather than hidden.
type PaymentTab = PaymentMilestoneStatus | "partial";

const TAB_ORDER: readonly PaymentTab[] = [
  "pending",
  "invoiced",
  "paid",
  "overdue",
  "partial",
];

const TAB_LABELS: Record<PaymentTab, string> = {
  pending: "待請款",
  invoiced: "已請款",
  paid: "已收款",
  overdue: "已逾期",
  waived: "已作廢",
  cancelled: "已取消",
  partial: "部分付款",
};

const EMPTY_LABELS: Record<PaymentTab, string> = {
  pending: "目前沒有待請款款項。",
  invoiced: "目前沒有已請款款項。",
  paid: "目前沒有已收款紀錄。",
  overdue: "目前沒有逾期款項。",
  waived: "沒有已作廢款項。",
  cancelled: "沒有已取消款項。",
  partial: "",
};

export function PaymentsView() {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<PaymentMilestone[]>([]);
  const [includeAmounts, setIncludeAmounts] = useState(false);
  const [tab, setTab] = useState<PaymentTab>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async (orgId: string) => {
    const page = await fetchPaymentMilestones(orgId, { limit: 200 });
    setMilestones(page.milestones);
    setIncludeAmounts(page.includeAmounts);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchPilotSession()
      .then(async (sessionData) => {
        const membership: PilotMembership | undefined = sessionData.memberships.find(
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

  const visible = useMemo(
    () => (tab === "partial" ? [] : milestones.filter((m) => m.status === tab)),
    [milestones, tab],
  );

  const runAction = async (
    id: string,
    fn: () => Promise<unknown>,
    fallback: string,
  ): Promise<void> => {
    if (!organizationId) return;
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
      await reload(organizationId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setBusyId(null);
    }
  };

  if (loadState === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="收款" />
        <PilotLoading label="正在載入收款資料" />
      </PilotPage>
    );
  }

  if (loadState === "restricted") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="收款" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">你沒有檢視權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            收款款項僅開放給負責人、管理員與派工人員。
          </p>
        </PilotCard>
      </PilotPage>
    );
  }

  if (loadState === "error") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="收款" />
        <PilotError
          title="收款資料讀不到"
          description="連線可能暫時中斷，款項狀態不會因此改變。請重新載入。"
          actionLabel="重新載入"
          onRetry={() => {
            setLoadState("loading");
            setAttempt((c) => c + 1);
          }}
        />
      </PilotPage>
    );
  }

  return (
    <PilotPage>
      <PilotBrand eyebrow="收款" />
      <header className="mb-5">
        <h1 className="text-[28px] font-black tracking-[-0.04em] text-ink">收款款項</h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          追蹤每個階段的請款與收款狀態。這裡只記錄狀態，不會實際扣款或串接金流。
        </p>
      </header>

      {actionError ? (
        <div className="mb-4">
          <PilotInlineNotice>{actionError}</PilotInlineNotice>
        </div>
      ) : null}

      <div role="tablist" aria-label="收款狀態" className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {TAB_ORDER.map((key) => {
          const active = key === tab;
          return (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold transition ${
                active
                  ? "bg-orange text-white"
                  : "border border-warm-border-strong bg-white text-ink-2 hover:border-orange/40"
              }`}
            >
              {TAB_LABELS[key]}
            </button>
          );
        })}
      </div>

      {tab === "partial" ? (
        <PilotCard className="py-10 text-center">
          <p className="text-sm font-black text-ink">尚未支援分批收款</p>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            目前僅追蹤每個階段的請款與收款狀態；同一筆款項拆成多次入帳（分批）尚未支援。
            需要拆分時，可先建立多個請款階段。
          </p>
        </PilotCard>
      ) : visible.length === 0 ? (
        <PilotCard className="py-10 text-center">
          <p className="text-sm leading-6 text-ink-3">{EMPTY_LABELS[tab]}</p>
        </PilotCard>
      ) : (
        <ul className="space-y-3">
          {visible.map((item) => (
            <li key={item.id}>
              <MilestoneCard
                milestone={item}
                includeAmounts={includeAmounts}
                busy={busyId === item.id}
                onInvoice={() =>
                  void runAction(
                    item.id,
                    () =>
                      invoicePaymentMilestone(
                        organizationId!,
                        item.id,
                        item.lockVersion,
                        undefined,
                      ),
                    "建立請款失敗，請稍後再試。",
                  )
                }
                onMarkPaid={() =>
                  void runAction(
                    item.id,
                    () =>
                      markPaymentMilestonePaid(
                        organizationId!,
                        item.id,
                        item.lockVersion,
                        {},
                      ),
                    "記錄收款失敗，請稍後再試。",
                  )
                }
                onWaive={() =>
                  void runAction(
                    item.id,
                    () =>
                      waivePaymentMilestone(
                        organizationId!,
                        item.id,
                        item.lockVersion,
                        "手動作廢",
                      ),
                    "作廢失敗，請稍後再試。",
                  )
                }
                onReverse={() =>
                  void runAction(
                    item.id,
                    () =>
                      reversePaymentMilestone(
                        organizationId!,
                        item.id,
                        item.lockVersion,
                        "誤記已收款",
                      ),
                    "沖銷失敗，請稍後再試。",
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </PilotPage>
  );
}

function MilestoneCard({
  milestone,
  includeAmounts,
  busy,
  onInvoice,
  onMarkPaid,
  onWaive,
  onReverse,
}: {
  milestone: PaymentMilestone;
  includeAmounts: boolean;
  busy: boolean;
  onInvoice: () => void;
  onMarkPaid: () => void;
  onWaive: () => void;
  onReverse: () => void;
}) {
  const overdueDays =
    milestone.status === "overdue" ? daysOverdue(milestone.dueOn) : null;

  return (
    <PilotCard>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-ink">{milestone.name}</p>
          <p className="mt-0.5 text-xs text-ink-3">第 {milestone.sequenceNo} 期</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${PAYMENT_STATUS_TONE[milestone.status]}`}
        >
          {PAYMENT_STATUS_LABELS[milestone.status]}
        </span>
      </div>

      {includeAmounts ? (
        <p className="mt-3 text-2xl font-black tracking-tight text-ink">
          {formatTwd(milestone.amountMinor)}
        </p>
      ) : null}

      <dl className="mt-3 space-y-1 text-xs text-ink-3">
        <div className="flex justify-between gap-3">
          <dt>付款期限</dt>
          <dd className="text-ink-2">{formatLocalDate(milestone.dueOn)}</dd>
        </div>
        {overdueDays !== null && overdueDays > 0 ? (
          <div className="flex justify-between gap-3">
            <dt>逾期天數</dt>
            <dd className="font-bold text-[var(--warm-red)]">已逾期 {overdueDays} 天</dd>
          </div>
        ) : null}
        {milestone.paymentMethod ? (
          <div className="flex justify-between gap-3">
            <dt>收款方式</dt>
            <dd className="text-ink-2">{milestone.paymentMethod}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {milestone.status === "pending" ? (
          <PilotButton type="button" disabled={busy} onClick={onInvoice}>
            {busy ? "處理中…" : "建立請款"}
          </PilotButton>
        ) : null}
        {milestone.status === "invoiced" || milestone.status === "overdue" ? (
          <PilotButton type="button" disabled={busy} onClick={onMarkPaid}>
            {busy ? "處理中…" : "記錄收款"}
          </PilotButton>
        ) : null}
        {milestone.status === "paid" ? (
          <PilotButton type="button" variant="secondary" disabled={busy} onClick={onReverse}>
            {busy ? "處理中…" : "沖銷收款"}
          </PilotButton>
        ) : null}
        {milestone.status === "pending" ||
        milestone.status === "invoiced" ||
        milestone.status === "overdue" ? (
          <PilotButton type="button" variant="danger" disabled={busy} onClick={onWaive}>
            作廢
          </PilotButton>
        ) : null}
      </div>
    </PilotCard>
  );
}
