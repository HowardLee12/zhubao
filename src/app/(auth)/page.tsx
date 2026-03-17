import { ProjectCard } from "@/components/project-card";
import { getProjects } from "@/lib/queries";
import { formatCurrency } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await getProjects();

  const activeProjects = projects.filter((p) => p.status !== "completed");
  const totalReceivable = projects
    .flatMap((p) => p.payments)
    .filter((p) => p.status === "due" || p.status === "upcoming")
    .reduce((sum, p) => sum + p.amount, 0);
  const totalPaid = projects
    .flatMap((p) => p.payments)
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <div>
      <header className="bg-primary text-primary-foreground px-4 py-4 flex justify-between items-center">
        <div>
          <div className="text-lg font-bold">裝潢工程管理</div>
          <div className="text-xs opacity-80">{projects.length} 個案件</div>
        </div>
        <Link
          href="/projects/new"
          className="bg-white/20 text-white text-sm px-3 py-1.5 rounded-lg font-medium"
        >
          + 新案件
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-2.5 p-4">
        <div className="bg-card rounded-xl p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">進行中</div>
          <div className="text-2xl font-bold text-primary">{activeProjects.length}</div>
        </div>
        <div className="bg-card rounded-xl p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">已收款</div>
          <div className="text-lg font-bold text-sage-700">{formatCurrency(totalPaid)}</div>
        </div>
        <div className="bg-card rounded-xl p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">待收款</div>
          <div className="text-lg font-bold text-destructive">{formatCurrency(totalReceivable)}</div>
        </div>
        <div className="bg-card rounded-xl p-3 shadow-sm">
          <div className="text-[11px] text-muted-foreground">案件總額</div>
          <div className="text-lg font-bold text-sage-800">
            {formatCurrency(projects.reduce((s, p) => s + p.total_amount, 0))}
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 space-y-4">
        <div className="text-sm font-semibold text-sage-800">所有案件</div>
        {projects.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <div className="text-4xl mb-3">🏗️</div>
            <div className="text-sm">還沒有案件</div>
            <Link
              href="/projects/new"
              className="inline-block mt-3 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium"
            >
              建立第一個案件
            </Link>
          </div>
        )}
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}
