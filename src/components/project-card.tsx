import Link from "next/link";
import { formatCurrencyShort } from "@/lib/format";
import { Pill } from "@/components/ui/pill";
import { ProjectRow, PaymentRow } from "@/lib/database.types";

interface ProjectWithRelations extends ProjectRow {
  payments: PaymentRow[];
}

const statusConfig = {
  in_progress: { label: "施工中", variant: "orange" as const },
  planning: { label: "規劃中", variant: "amber" as const },
  completed: { label: "已完工", variant: "green" as const },
};

export function ProjectCard({ project }: { project: ProjectWithRelations }) {
  const status = statusConfig[project.status];
  const dueCount = project.payments.filter(
    (p) => p.status === "due" || p.status === "upcoming"
  ).length;

  return (
    <Link href={`/projects/${project.id}`} className="block mx-4 mb-2">
      <div className="bg-surface rounded-2xl border border-warm-border p-3.5 flex gap-3 items-center active:scale-[0.99] transition-transform">
        <div
          className="w-12 h-12 rounded-xl border border-warm-border shrink-0 flex items-center justify-center text-[10px] text-ink-3 font-mono"
          style={{
            background:
              "repeating-linear-gradient(135deg, var(--bg-warm) 0 6px, var(--warm-border) 6px 7px)",
          }}
        >
          {project.address?.slice(0, 2) || "案"}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[15px] font-semibold truncate text-ink leading-tight">
              {project.customer_name} · {project.description || "案件"}
            </div>
            <Pill variant={status.variant} className="shrink-0">
              {status.label}
            </Pill>
          </div>

          <div className="text-[11px] text-ink-3 mt-1 font-mono truncate">
            {project.address} · {formatCurrencyShort(project.total_amount)}
            {dueCount > 0 && (
              <span className="text-[var(--warm-red)] font-semibold ml-2">
                · {dueCount} 筆待收
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-1 bg-bg-warm rounded-full overflow-hidden">
              <div
                className="h-full bg-orange rounded-full transition-all"
                style={{ width: `${project.progress}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-ink-3 min-w-[28px] text-right tabular-nums">
              {project.progress}%
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
