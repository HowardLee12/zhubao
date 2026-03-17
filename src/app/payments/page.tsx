import { getProjects } from "@/lib/queries";
import { formatCurrency } from "@/lib/format";
import { PaymentsPageList } from "@/components/payments-page-list";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const projects = await getProjects();

  const allPayments = projects.flatMap((p) =>
    p.payments.map((payment) => ({
      ...payment,
      projectId: p.id,
      projectName: `${p.customer_name} — ${p.address}`,
    }))
  );

  const totalPaid = allPayments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);
  const totalUnpaid = allPayments
    .filter((p) => p.status !== "paid")
    .reduce((s, p) => s + p.amount, 0);

  return (
    <div>
      <header className="bg-primary text-primary-foreground px-4 py-3">
        <div className="text-lg font-bold">收款管理</div>
        <div className="text-xs opacity-80">
          已收 {formatCurrency(totalPaid)} · 待收 {formatCurrency(totalUnpaid)}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2.5 p-4">
        <div className="bg-card rounded-xl p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">已收款</div>
          <div className="text-lg font-bold text-sage-600">{formatCurrency(totalPaid)}</div>
        </div>
        <div className="bg-card rounded-xl p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">待收款</div>
          <div className="text-lg font-bold text-destructive">{formatCurrency(totalUnpaid)}</div>
        </div>
      </div>

      <PaymentsPageList payments={allPayments} />
    </div>
  );
}
