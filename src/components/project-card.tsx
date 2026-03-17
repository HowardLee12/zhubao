import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import { ProjectRow, PaymentRow } from "@/lib/database.types";

interface ProjectWithRelations extends ProjectRow {
  payments: PaymentRow[];
}

const statusConfig = {
  in_progress: { label: "施工中", className: "bg-sage-100 text-sage-700" },
  planning: { label: "規劃中", className: "bg-amber-50 text-amber-700" },
  completed: { label: "已完工", className: "bg-emerald-50 text-emerald-700" },
} as const;

export function ProjectCard({ project }: { project: ProjectWithRelations }) {
  const status = statusConfig[project.status];
  const paidAmount = project.payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);
  const dueCount = project.payments.filter((p) => p.status === "due").length;

  return (
    <Link href={`/projects/${project.id}`} className="block">
      <div className="bg-card rounded-xl shadow-sm border border-sage-200 overflow-hidden active:scale-[0.98] transition-transform">
        <div className="p-4 flex justify-between items-start">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[15px] truncate">
              {project.customer_name} — {project.address}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {project.description} · {formatCurrency(project.total_amount)}
            </div>
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ml-2 ${status.className}`}>
            {status.label}
          </span>
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 h-2 bg-sage-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${project.progress}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-primary min-w-[36px] text-right">
              {project.progress}%
            </span>
          </div>

          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>已收 {formatCurrency(paidAmount)}</span>
            {dueCount > 0 && (
              <span className="text-destructive font-medium">
                {dueCount} 筆待收
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
