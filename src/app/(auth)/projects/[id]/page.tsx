import { getProject, getQuotesByProject } from "@/lib/queries";
import { notFound } from "next/navigation";
import { AddTradeForm } from "@/components/add-trade-form";
import { AddPaymentForm } from "@/components/add-payment-form";
import { ProjectStatusControl } from "@/components/project-status-control";
import { TradeList } from "@/components/trade-list";
import { PaymentList } from "@/components/payment-list";
import { ProjectQuotesSection } from "@/components/project-quotes-section";
import { ProjectHeader } from "@/components/project-header";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, quotes] = await Promise.all([
    getProject(id),
    getQuotesByProject(id),
  ]);
  if (!project) return notFound();

  return (
    <div>
      <ProjectHeader project={project} />

      {/* Status & Progress */}
      <div className="p-4">
        <ProjectStatusControl
          projectId={project.id}
          currentStatus={project.status}
          currentProgress={project.progress}
        />
      </div>

      {/* Quotes for this project */}
      <div className="px-4 pb-4">
        <ProjectQuotesSection projectId={project.id} quotes={quotes} />
      </div>

      {/* Trades section */}
      <div className="px-4 pb-4">
        <div className="text-sm font-semibold text-sage-800 mb-3">工種進度</div>
        {project.trades.length > 0 && (
          <div className="mb-3">
            <TradeList trades={project.trades} projectId={project.id} />
          </div>
        )}
        <AddTradeForm projectId={project.id} />
      </div>

      {/* Payments section */}
      <div className="px-4 pb-4">
        <div className="text-sm font-semibold text-sage-800 mb-3">收款進度</div>
        {project.payments.length > 0 && (
          <div className="mb-3">
            <PaymentList
              payments={project.payments}
              projectId={project.id}
              totalAmount={project.total_amount}
            />
          </div>
        )}
        <AddPaymentForm projectId={project.id} totalAmount={project.total_amount} />
      </div>
    </div>
  );
}
