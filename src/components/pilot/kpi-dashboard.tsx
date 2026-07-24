"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchPilotSession, type PilotMembership } from "./api";
import { fetchDashboard, type DashboardResult, type Kpi } from "./operations-api";
import {
  formatKpiDuration,
  formatKpiRate,
  formatLocalDate,
  timeOfDayGreeting,
} from "./operations-format";
import {
  PilotBrand,
  PilotButton,
  PilotCard,
  PilotLoading,
  PilotPage,
} from "./ui";
import { MANAGER_ROLES } from "./work-order-format";

type LoadState = "loading" | "ready" | "error" | "restricted";

// Only owner/admin/dispatcher reach the dashboard. Technicians never see KPI or
// cost — the RPC 403s them, but the client also refuses to fetch so no request
// leaves the browser.
type MetricKey = keyof DashboardResult["metrics"];

const METRIC_ORDER: readonly MetricKey[] = [
  "firstResponseTime",
  "quoteAcceptanceRate",
  "completionRate",
  "revisitRate",
];

const METRIC_LABELS: Record<MetricKey, string> = {
  firstResponseTime: "首次回覆時間",
  quoteAcceptanceRate: "報價接受率",
  completionRate: "完工率",
  revisitRate: "回訪率",
};

const METRIC_HINTS: Record<MetricKey, string> = {
  firstResponseTime: "進件到第一次回覆的中位數（分鐘）。",
  quoteAcceptanceRate: "期間內送出的報價被客戶接受的比例。",
  completionRate: "已完工 ÷（完工＋取消＋逾期未完）。",
  revisitRate: "回訪提醒送出後 30 天內回頭下單的客戶比例。",
};

// firstResponseTime reports a median duration, not a ratio; the rest are ratios.
const RATE_METRICS = new Set<MetricKey>([
  "quoteAcceptanceRate",
  "completionRate",
  "revisitRate",
]);

export function KpiDashboard() {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [displayName, setDisplayName] = useState("");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResult | null>(null);

  const reload = useCallback(async (orgId: string) => {
    const data = await fetchDashboard(orgId);
    setDashboard(data);
  }, []);

  const retry = () => {
    setLoadState("loading");
    setAttempt((c) => c + 1);
  };

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
        if (active) setDisplayName(membership.displayName);
        try {
          await reload(membership.organizationId);
          if (!active) return;
          setOrganizationId(membership.organizationId);
          setLoadState("ready");
        } catch {
          // The KPI widget degrades on its own — the greeting/shell still renders.
          if (!active) return;
          setOrganizationId(membership.organizationId);
          setLoadState("error");
        }
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [attempt, reload]);

  if (loadState === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="工作台" />
        <PilotLoading label="正在載入營運指標" />
      </PilotPage>
    );
  }

  if (loadState === "restricted") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="工作台" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">你沒有檢視權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            營運指標僅開放給負責人、管理員與派工人員。
          </p>
        </PilotCard>
      </PilotPage>
    );
  }

  const windowLabel = dashboard
    ? `${formatLocalDate(dashboard.window.from)} – ${formatLocalDate(dashboard.window.to)}`
    : null;

  return (
    <PilotPage>
      <PilotBrand eyebrow="工作台" />
      <header className="mb-5">
        <h1 className="text-[28px] font-black tracking-[-0.04em] text-ink">
          {timeOfDayGreeting(displayName || "老闆")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          {windowLabel ? `營運指標區間：${windowLabel}（Asia/Taipei）` : "今天的營運指標概覽。"}
        </p>
      </header>

      {loadState === "error" || !dashboard ? (
        <PilotCard className="py-8 text-center">
          <div role="alert">
            <p className="text-sm font-black text-ink">指標暫時讀不到</p>
            <p className="mt-2 text-sm leading-6 text-ink-3">
              連線可能中斷，資料不會因此改變。其他工作台功能仍可正常使用。
            </p>
          </div>
          <PilotButton
            className="mt-5 w-full"
            onClick={retry}
          >
            重新載入指標
          </PilotButton>
        </PilotCard>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {METRIC_ORDER.map((key) => (
            <KpiCard
              key={key}
              label={METRIC_LABELS[key]}
              hint={METRIC_HINTS[key]}
              kpi={dashboard.metrics[key]}
              isRate={RATE_METRICS.has(key)}
            />
          ))}
        </div>
      )}
      {/* organizationId retained for future drill-through; referenced to avoid dead state. */}
      <span className="sr-only">{organizationId ?? ""}</span>
    </PilotPage>
  );
}

function KpiCard({
  label,
  hint,
  kpi,
  isRate,
}: Readonly<{
  label: string;
  hint: string;
  kpi: Kpi;
  isRate: boolean;
}>) {
  return (
    <PilotCard className="p-4">
      <p className="text-xs font-bold text-ink-2">{label}</p>
      {kpi.available && kpi.numerator !== null && kpi.denominator !== null ? (
        <>
          <p className="mt-2 text-2xl font-black tracking-tight text-ink">
            {isRate
              ? formatKpiRate(kpi.numerator, kpi.denominator)
              : formatKpiDuration(kpi.numerator)}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">
            {isRate
              ? `${kpi.numerator} / ${kpi.denominator}`
              : `樣本 ${kpi.denominator} 件`}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm font-bold text-ink-3">尚無足夠資料</p>
      )}
      <p className="mt-2 text-[11px] leading-4 text-ink-4">{hint}</p>
    </PilotCard>
  );
}

