"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchPilotSession, PilotApiError, type PilotMembership } from "./api";
import {
  convertMaintenancePlan,
  fetchMaintenancePlans,
  prepareMaintenanceReminders,
  type MaintenancePlan,
} from "./operations-api";
import {
  followUpTab,
  formatLocalDate,
  MAINTENANCE_STATUS_LABELS,
  type FollowUpTab,
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

const TAB_ORDER: readonly FollowUpTab[] = ["due", "later", "converted", "skipped"];

const TAB_LABELS: Record<FollowUpTab, string> = {
  due: "本週到期",
  later: "稍後",
  converted: "已轉單",
  skipped: "已略過",
};

const EMPTY_LABELS: Record<FollowUpTab, string> = {
  due: "本週沒有到期的回訪。",
  later: "沒有排在稍後的回訪。",
  converted: "還沒有已轉成案件的回訪。",
  skipped: "沒有已略過或暫停的回訪。",
};

// The tabs are DERIVED from plan status + next-due date (ADR 0007: no revisits
// table). A revisit reminder is only ever a draft — staff approves it before it
// can send. Converting reuses M2/M3 intake by creating a source=revisit request.
export function FollowUpsView() {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [plans, setPlans] = useState<MaintenancePlan[]>([]);
  const [tab, setTab] = useState<FollowUpTab>("due");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [conflictPlan, setConflictPlan] = useState<MaintenancePlan | null>(null);

  const reload = useCallback(async (orgId: string) => {
    const rows = await fetchMaintenancePlans(orgId, { limit: 200 });
    setPlans(rows);
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
    () => plans.filter((p) => followUpTab(p) === tab),
    [plans, tab],
  );

  const doPrepare = async (planId: string) => {
    if (!organizationId) return;
    setBusyId(planId);
    setNotice(null);
    try {
      const result = await prepareMaintenanceReminders(organizationId, [planId]);
      setNotice({
        tone: "success",
        text: `已準備 ${result.prepared} 筆回訪提醒草稿，核准後才會送出。`,
      });
    } catch (cause) {
      setNotice({
        tone: "error",
        text: cause instanceof Error ? cause.message : "準備回訪提醒失敗，請稍後再試。",
      });
    } finally {
      setBusyId(null);
    }
  };

  const doConvert = async (plan: MaintenancePlan, force: boolean) => {
    if (!organizationId) return;
    setBusyId(plan.id);
    setNotice(null);
    try {
      const result = await convertMaintenancePlan(organizationId, plan.id, plan.lockVersion, {
        subject: "回訪保養",
        ...(force ? { force: true } : {}),
      });
      setConflictPlan(null);
      const requestSuffix = result.requestNo ? `（${result.requestNo}）` : "";
      setNotice({
        tone: "success",
        text: `已建立新案件${requestSuffix}，可到接案匣繼續分流。`,
      });
      await reload(organizationId);
    } catch (cause) {
      if (cause instanceof PilotApiError && cause.status === 409) {
        setConflictPlan(plan);
      } else {
        setNotice({
          tone: "error",
          text: cause instanceof Error ? cause.message : "轉成新案件失敗，請稍後再試。",
        });
      }
    } finally {
      setBusyId(null);
    }
  };

  if (loadState === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="回訪" />
        <PilotLoading label="正在載入回訪清單" />
      </PilotPage>
    );
  }

  if (loadState === "restricted") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="回訪" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">你沒有檢視權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            回訪清單僅開放給負責人、管理員與派工人員。
          </p>
        </PilotCard>
      </PilotPage>
    );
  }

  if (loadState === "error") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="回訪" />
        <PilotError
          title="回訪資料讀不到"
          description="連線可能暫時中斷，保養排程不會因此改變。請重新載入。"
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
      <PilotBrand eyebrow="回訪" />
      <header className="mb-5">
        <h1 className="text-[28px] font-black tracking-[-0.04em] text-ink">保養回訪</h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          到期的保養方案。提醒只會先產生草稿，經你核准後才送給客戶；也可以一鍵轉成新案件。
        </p>
      </header>

      {notice ? (
        <div className="mb-4">
          <PilotInlineNotice tone={notice.tone}>{notice.text}</PilotInlineNotice>
        </div>
      ) : null}

      <div role="tablist" aria-label="回訪狀態" className="mb-5 flex gap-2 overflow-x-auto pb-1">
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

      {visible.length === 0 ? (
        <PilotCard className="py-10 text-center">
          <p className="text-sm leading-6 text-ink-3">{EMPTY_LABELS[tab]}</p>
        </PilotCard>
      ) : (
        <ul className="space-y-3">
          {visible.map((plan) => (
            <li key={plan.id}>
              <PilotCard>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-ink">{plan.name}</p>
                    <p className="mt-0.5 text-xs text-ink-3">
                      每 {plan.cadenceMonths} 個月 · 下次 {formatLocalDate(plan.nextDueOn)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-warm-border px-3 py-1 text-xs font-bold text-ink-3">
                    {MAINTENANCE_STATUS_LABELS[plan.status]}
                  </span>
                </div>

                {tab === "due" ? (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <PilotButton
                      type="button"
                      variant="secondary"
                      disabled={busyId === plan.id}
                      onClick={() => void doPrepare(plan.id)}
                    >
                      {busyId === plan.id ? "處理中…" : "準備回訪提醒"}
                    </PilotButton>
                    <PilotButton
                      type="button"
                      disabled={busyId === plan.id}
                      onClick={() => void doConvert(plan, false)}
                    >
                      轉成新案件
                    </PilotButton>
                  </div>
                ) : null}
              </PilotCard>
            </li>
          ))}
        </ul>
      )}

      {conflictPlan ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-4 sm:items-center sm:justify-center">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="convert-conflict-title"
            className="w-full max-w-sm rounded-[24px] bg-white p-5 shadow-2xl"
          >
            <h2 id="convert-conflict-title" className="text-xl font-black text-ink">
              此設備已有進行中的案件
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-3">
              為避免重複派工，系統沒有自動建立。你可以先確認既有案件，或仍要為這次回訪建立一筆新案件。
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <PilotButton
                type="button"
                variant="secondary"
                disabled={busyId === conflictPlan.id}
                onClick={() => setConflictPlan(null)}
              >
                先不要
              </PilotButton>
              <PilotButton
                type="button"
                disabled={busyId === conflictPlan.id}
                onClick={() => void doConvert(conflictPlan, true)}
              >
                仍要建立新案件
              </PilotButton>
            </div>
          </div>
        </div>
      ) : null}
    </PilotPage>
  );
}
