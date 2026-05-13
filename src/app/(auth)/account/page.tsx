import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getUserProfile,
  getUserUsage,
  getProjects,
  PLAN_LIMITS,
} from "@/lib/queries";
import { LogoutButton } from "@/components/logout-button";
import { PricingSurvey } from "@/components/pricing-survey";
import { TopBar } from "@/components/ui/top-bar";
import { Pill } from "@/components/ui/pill";

export const dynamic = "force-dynamic";

const PLAN_LABELS: Record<string, string> = {
  free: "免費版",
  pro: "專業版",
};

function ChevronIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-4"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function MenuRow({
  label,
  hint,
  href,
}: Readonly<{
  label: string;
  hint?: string;
  href: string;
}>) {
  return (
    <Link
      href={href}
      className="px-4 py-3.5 flex items-center gap-3 active:bg-bg-warm/50"
    >
      <div className="flex-1 text-[14px] font-medium text-ink">{label}</div>
      {hint && (
        <span className="text-[11px] text-ink-3 font-mono">{hint}</span>
      )}
      <ChevronIcon />
    </Link>
  );
}

export default async function AccountPage() {
  const [profile, usage, projects] = await Promise.all([
    getUserProfile(),
    getUserUsage(),
    getProjects(),
  ]);

  if (!profile) redirect("/dashboard");

  const plan = profile.plan ?? "free";
  const quoteLimit = PLAN_LIMITS[plan]?.quotes ?? PLAN_LIMITS.free.quotes;
  const projectLimit = PLAN_LIMITS[plan]?.projects ?? PLAN_LIMITS.free.projects;
  const isFreePlan = plan === "free";

  // Hours-saved estimate (rough, not stored as event log yet):
  //   per quote ~30 min saved vs. Excel
  //   per trade scheduled ~5 min saved vs. LINE chat back-and-forth
  //   per payment status update ~3 min saved
  const totalTrades = projects.reduce((s, p) => s + p.trades.length, 0);
  const totalPayments = projects.reduce((s, p) => s + p.payments.length, 0);
  const minutesSaved = usage.quoteCount * 30 + totalTrades * 5 + totalPayments * 3;
  const hoursSaved = Math.round((minutesSaved / 60) * 10) / 10;

  return (
    <div className="pb-24">
      <TopBar title="帳號" subtitle="管理你的帳號與方案" />

      {/* Profile card */}
      <div className="px-4 mt-1">
        <div className="bg-surface rounded-2xl border border-warm-border p-4 flex items-center gap-3">
          {profile.picture_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.picture_url}
              alt={profile.display_name}
              className="w-14 h-14 rounded-full object-cover border-2 border-orange-soft"
            />
          ) : (
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, #E2691F 0%, #A04428 100%)",
              }}
            >
              {profile.display_name?.charAt(0) || "?"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold truncate text-ink">
              {profile.display_name}
            </div>
            <div className="text-[11px] text-ink-3 mt-0.5">LINE 帳號登入</div>
            <div className="mt-1.5">
              <Pill variant={isFreePlan ? "neutral" : "orange"}>
                {PLAN_LABELS[plan] ?? plan} 方案
              </Pill>
            </div>
          </div>
        </div>
      </div>

      {/* Hours saved card */}
      <div className="px-4 mt-3">
        <div className="rounded-2xl p-4 bg-ink text-white">
          <div className="text-[12px] opacity-65">本月 Renoly 為您省了</div>
          <div className="font-mono text-3xl font-bold mt-1 tracking-tight text-orange-soft tabular-nums">
            {hoursSaved} 小時
          </div>
          <div className="text-[11px] opacity-55 mt-1">
            根據 {usage.quoteCount} 份報價、{totalTrades} 筆排程、{totalPayments} 筆收款試算
          </div>
        </div>
      </div>

      {/* Usage / plan limits */}
      <div className="px-4 mt-3">
        <div className="text-[13px] font-semibold text-ink-2 mb-2 tracking-wider">
          使用量
        </div>
        <div className="bg-surface rounded-2xl border border-warm-border p-4 space-y-3">
          <UsageBar
            label="報價單"
            count={usage.quoteCount}
            limit={quoteLimit}
            showBar={isFreePlan && quoteLimit !== Infinity}
          />
          <UsageBar
            label="案件數"
            count={usage.projectCount}
            limit={projectLimit}
            showBar={isFreePlan && projectLimit !== Infinity}
          />
        </div>
      </div>

      {/* Menu list */}
      <div className="px-4 mt-3">
        <div className="text-[13px] font-semibold text-ink-2 mb-2 tracking-wider">
          管理
        </div>
        <div className="bg-surface rounded-2xl border border-warm-border divide-y divide-warm-border overflow-hidden">
          <MenuRow label="工班通訊錄" href="/account/crews" hint="管理常用工班" />
          <MenuRow label="報價單" href="/quotes" hint={`${usage.quoteCount} 份`} />
          <MenuRow
            label="意見反饋"
            href="mailto:wei00925@gmail.com?subject=Renoly%20意見反饋"
          />
        </div>
      </div>

      {/* Pricing survey for free users */}
      {isFreePlan && (
        <div className="px-4 mt-3">
          <PricingSurvey
            userId={profile.id}
            userName={profile.display_name ?? ""}
          />
        </div>
      )}

      {/* Logout */}
      <div className="px-4 mt-3 mb-6">
        <LogoutButton />
      </div>

      {/* Brand footer */}
      <div className="text-center text-[10px] text-ink-3 pb-4 font-mono">
        Renoly · 裝修小隊的接案管家
      </div>
    </div>
  );
}

function UsageBar({
  label,
  count,
  limit,
  showBar,
}: Readonly<{
  label: string;
  count: number;
  limit: number;
  showBar: boolean;
}>) {
  const max = limit === Infinity ? null : limit;
  const pct = max ? Math.min((count / max) * 100, 100) : 0;
  const danger = max ? count >= max : false;

  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-ink-3">{label}</span>
        <span className="font-medium font-mono tabular-nums text-ink">
          {count} / {max ?? "無限"}
        </span>
      </div>
      {showBar && (
        <div className="w-full bg-bg-warm rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all ${
              danger ? "bg-[var(--warm-red)]" : "bg-orange"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
