import { getProjects } from "@/lib/queries";
import { formatCurrencyShort, formatDate } from "@/lib/format";
import { PaymentsPageList } from "@/components/payments-page-list";
import { TopBar } from "@/components/ui/top-bar";
import { StatCard } from "@/components/ui/stat-card";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const projects = await getProjects();
  const today = new Date().toISOString().slice(0, 10);

  const allPayments = projects.flatMap((p) =>
    p.payments.map((payment) => ({
      ...payment,
      projectId: p.id,
      projectName: `${p.customer_name} · ${p.description || p.address}`,
    }))
  );

  const paid = allPayments.filter((p) => p.status === "paid");
  const overdue = allPayments.filter(
    (p) => p.status === "due" || (p.due_date && p.due_date < today && p.status !== "paid")
  );
  const totalPaid = paid.reduce((s, p) => s + p.amount, 0);
  const totalUnpaid = allPayments
    .filter((p) => p.status !== "paid")
    .reduce((s, p) => s + p.amount, 0);
  const overdueAmount = overdue.reduce((s, p) => s + p.amount, 0);
  const nextDue = allPayments
    .filter((p) => p.status !== "paid" && p.due_date)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0];

  return (
    <div className="pb-24">
      <TopBar
        title="收款追蹤"
        subtitle={`已收 ${formatCurrencyShort(totalPaid)} · 待收 ${formatCurrencyShort(totalUnpaid)}`}
      />

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-2 px-4 mt-1">
        <StatCard
          variant="dark"
          label="已收款"
          value={formatCurrencyShort(totalPaid)}
          delta={`${paid.length} 筆`}
          deltaColor="success"
        />
        <StatCard
          variant="accent"
          label="待收款"
          value={formatCurrencyShort(totalUnpaid)}
          delta={
            nextDue?.due_date
              ? `最近到期 ${formatDate(nextDue.due_date)}`
              : "本期清空"
          }
        />
      </div>

      {/* Overdue alert */}
      {overdue.length > 0 && (
        <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl bg-[var(--warm-red-soft)] border border-[var(--warm-red)]/30 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--warm-red)] text-white flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 5 2 7 2 7H4s2-2 2-7" />
              <path d="M10 19a2 2 0 0 0 4 0" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-[var(--warm-red)]">
              {overdue.length} 筆已到期未收 · {formatCurrencyShort(overdueAmount)}
            </div>
            <div className="text-[11px] text-ink-2 mt-0.5 truncate">
              建議在下方點「LINE 催款」聯絡屋主
            </div>
          </div>
        </div>
      )}

      <PaymentsPageList payments={allPayments} />
    </div>
  );
}
