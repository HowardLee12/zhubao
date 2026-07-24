import type { MaintenancePlanStatus, PaymentMilestoneStatus } from "./operations-api";

// Shared M8 display helpers. Amounts are integer minor units; per the org
// convention TWD tracks whole NTD in minor units (no cent division), matching the
// existing quote surfaces. Dates are stored UTC and displayed in Asia/Taipei.

export function formatTwd(amountMinor: number | undefined): string {
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor)) {
    return "—";
  }
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(amountMinor);
}

export function formatLocalDate(value: string | null): string {
  if (!value) return "未設定";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeZone: "Asia/Taipei",
  }).format(date);
}

// Whole-day difference between an org-local due date and "today" in Asia/Taipei.
// Positive = overdue by N days; used only for honest surfacing, never for state.
export function daysOverdue(dueOn: string | null, now: Date = new Date()): number | null {
  if (!dueOn) return null;
  const due = new Date(`${dueOn}T00:00:00+08:00`);
  if (Number.isNaN(due.getTime())) return null;
  const nowLocalMidnight = new Date(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(now) + "T00:00:00+08:00",
  );
  const diffMs = nowLocalMidnight.getTime() - due.getTime();
  return Math.floor(diffMs / 86_400_000);
}

export const PAYMENT_STATUS_LABELS: Record<PaymentMilestoneStatus, string> = {
  pending: "待請款",
  invoiced: "已請款",
  overdue: "已逾期",
  paid: "已收款",
  waived: "已作廢",
  cancelled: "已取消",
};

export const PAYMENT_STATUS_TONE: Record<PaymentMilestoneStatus, string> = {
  pending: "bg-orange-soft text-orange-deep",
  invoiced: "bg-orange-soft text-orange-deep",
  overdue: "bg-[var(--warm-red-soft)] text-[var(--warm-red)]",
  paid: "bg-[var(--warm-green-soft)] text-[var(--warm-green)]",
  waived: "bg-warm-border text-ink-3",
  cancelled: "bg-warm-border text-ink-3",
};

export const MAINTENANCE_STATUS_LABELS: Record<MaintenancePlanStatus, string> = {
  active: "進行中",
  paused: "已暫停",
  completed: "已完成",
  cancelled: "已取消",
};

export const ASSET_TYPE_LABELS: Record<string, string> = {
  air_conditioner: "冷氣",
  water_heater: "熱水器",
  pump: "抽水馬達",
  appliance: "家電",
  other: "其他設備",
};

export const ASSET_EVENT_LABELS: Record<string, string> = {
  "asset.serviced": "保養／清洗",
  "asset.inspected": "檢查",
  "asset.repaired": "維修",
  "asset.installed": "安裝",
  "asset.note": "備註",
  "asset.updated": "資料更新",
  "asset.retired": "已停用",
};

export function assetTypeLabel(type: string): string {
  return ASSET_TYPE_LABELS[type] ?? type;
}

export function assetEventLabel(eventType: string): string {
  return ASSET_EVENT_LABELS[eventType] ?? eventType;
}

// KPI presentation helpers (pure, so they are unit-tested directly). A rate whose
// denominator is non-positive degrades to the honest "尚無足夠資料" rather than 0%.
export function formatKpiRate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "尚無足夠資料";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function formatKpiDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} 分`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} 時`;
  return `${(hours / 24).toFixed(1)} 天`;
}

export function timeOfDayGreeting(name: string, now: Date = new Date()): string {
  const hour = now.getHours();
  let part = "晚安";
  if (hour < 12) part = "早安";
  else if (hour < 18) part = "午安";
  return `${part}，${name}`;
}

// Follow-up derived tabs from a plan's status + next-due date. This is the
// deliberate "derived, not a revisits table" design (see ADR 0007). A plan whose
// next due date falls within lead-days of today is "this week"; further out is
// "later"; completed plans are the converted/handled set.
export type FollowUpTab = "due" | "later" | "converted" | "skipped";

export function followUpTab(
  plan: { status: MaintenancePlanStatus; nextDueOn: string; leadDays: number },
  now: Date = new Date(),
): FollowUpTab {
  if (plan.status === "completed") return "converted";
  if (plan.status === "cancelled" || plan.status === "paused") return "skipped";
  const due = new Date(`${plan.nextDueOn}T00:00:00+08:00`);
  if (Number.isNaN(due.getTime())) return "later";
  const leadMs = Math.max(plan.leadDays, 0) * 86_400_000;
  return due.getTime() - now.getTime() <= leadMs ? "due" : "later";
}
