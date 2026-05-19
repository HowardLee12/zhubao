import { ProjectCard } from "@/components/project-card";
import { TodayTradeStrip } from "@/components/today-trade-strip";
import { TopBar, TopBarIconButton } from "@/components/ui/top-bar";
import { StatCard } from "@/components/ui/stat-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Pill } from "@/components/ui/pill";
import { getProjects, getUserProfile, getUserUsage, canCreateProject } from "@/lib/queries";
import { formatCurrencyShort, formatDateLong, greeting } from "@/lib/format";
import { OnboardingCard } from "@/components/onboarding-card";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import Link from "next/link";

export const dynamic = "force-dynamic";

function startOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default async function DashboardPage() {
  const [projects, profile, usage, canCreate] = await Promise.all([
    getProjects(),
    getUserProfile(),
    getUserUsage(),
    canCreateProject(),
  ]);

  const now = new Date();

  // First-run: no projects yet → focused onboarding instead of empty NT$0 noise
  if (projects.length === 0) {
    return (
      <div>
        <TopBar
          title={`${greeting(now)}，${profile?.display_name || "工程夥伴"}`}
          subtitle={formatDateLong(now)}
        />
        <OnboardingCard canCreate={canCreate} />
      </div>
    );
  }
  const monthStart = startOfMonth(now);
  const allPayments = projects.flatMap((p) => p.payments);

  const duePayments = allPayments.filter(
    (p) => p.status === "due" || p.status === "upcoming"
  );
  const totalDue = duePayments.reduce((s, p) => s + p.amount, 0);
  const nextDue = duePayments
    .filter((p) => p.due_date)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0];

  const paidThisMonth = allPayments.filter(
    (p) => p.status === "paid" && p.paid_date && p.paid_date >= monthStart
  );
  const totalPaidMonth = paidThisMonth.reduce((s, p) => s + p.amount, 0);

  const activeProjects = projects.filter((p) => p.status !== "completed");
  const allTrades = projects.flatMap((p) =>
    p.trades.map((t) => ({ ...t, project_address: p.address }))
  );

  const dueLabel = (() => {
    if (nextDue?.due_date) {
      return `${duePayments.length} 筆 · ${nextDue.due_date.slice(5).replace("-", "/")} 到期`;
    }
    if (duePayments.length > 0) return `${duePayments.length} 筆待收`;
    return "本期清空";
  })();

  return (
    <div>
      <TopBar
        title={`${greeting(now)}，${profile?.display_name || "工程夥伴"}`}
        subtitle={formatDateLong(now)}
        right={
          <TopBarIconButton href="/schedule" ariaLabel="今日排程">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 5 2 7 2 7H4s2-2 2-7" />
              <path d="M10 19a2 2 0 0 0 4 0" />
            </svg>
          </TopBarIconButton>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 px-4 mt-1">
        <StatCard
          variant="accent"
          label="待收款"
          value={formatCurrencyShort(totalDue)}
          delta={dueLabel}
        />
        <StatCard
          label="本月已入帳"
          value={formatCurrencyShort(totalPaidMonth)}
          delta={`${paidThisMonth.length} 筆已入帳`}
          deltaColor={paidThisMonth.length > 0 ? "success" : "default"}
        />
      </div>

      {/* Not yet activated: nudge toward first quote */}
      {usage.quoteCount === 0 && projects[0] && (
        <OnboardingChecklist firstProjectId={projects[0].id} />
      )}

      {/* Today */}
      <SectionHeader
        title={`今日工地 · ${formatDateLong(now).slice(0, formatDateLong(now).indexOf(" "))}`}
        action={{ label: "查看排程", href: "/schedule" }}
      />
      <TodayTradeStrip trades={allTrades} projects={projects} />

      {/* Active projects */}
      <SectionHeader
        title={`進行中案件 · ${activeProjects.length}`}
        action={canCreate ? { label: "新增", href: "/projects/new" } : undefined}
      />

      {projects.length === 0 ? (
        <div className="text-center py-10 px-6">
          <div className="text-sm text-ink-3 mb-3">還沒有案件</div>
          {canCreate ? (
            <Link
              href="/projects/new"
              className="inline-block bg-orange text-white px-4 py-2.5 rounded-xl text-sm font-semibold"
            >
              建立第一個案件
            </Link>
          ) : (
            <Link href="/account" className="text-orange text-sm font-medium">
              升級方案 →
            </Link>
          )}
        </div>
      ) : (
        <>
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
          {canCreate && (
            <Link
              href="/projects/new"
              className="mx-4 mt-2 mb-6 block py-4 rounded-2xl border-2 border-dashed border-warm-border-strong bg-surface-warm text-center text-sm font-medium text-ink-2"
            >
              <span className="inline-flex items-center gap-1.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                新增案件
              </span>
            </Link>
          )}
        </>
      )}

      {!canCreate && (
        <div className="mx-4 mb-6 px-3 py-2.5 rounded-xl bg-orange-soft border border-orange/30 text-[12px] text-orange-deep flex items-center justify-between">
          <span>案件數已達免費方案上限</span>
          <Link href="/account" className="font-semibold">
            升級 →
          </Link>
        </div>
      )}

      {/* hint of plan */}
      {profile?.plan === "free" && (
        <div className="mx-4 mb-6">
          <Pill variant="neutral">免費方案</Pill>
        </div>
      )}
    </div>
  );
}
