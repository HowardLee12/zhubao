import { getProject, getQuotesByProject, canCreateQuote, getPhotosByProject, canUploadPhoto, getPhotoPublicUrl } from "@/lib/queries";
import { notFound } from "next/navigation";
import { AddTradeForm } from "@/components/add-trade-form";
import { AddPaymentForm } from "@/components/add-payment-form";
import { ProjectStatusControl } from "@/components/project-status-control";
import { TradeList } from "@/components/trade-list";
import { PaymentList } from "@/components/payment-list";
import { ProjectQuotesSection } from "@/components/project-quotes-section";
import { ProjectHeader } from "@/components/project-header";
import { PhotoGrid } from "@/components/photo-grid";
import { PhotoUpload } from "@/components/photo-upload";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, quotes, canCreate, photos, photoQuota] = await Promise.all([
    getProject(id),
    getQuotesByProject(id),
    canCreateQuote(),
    getPhotosByProject(id),
    canUploadPhoto(id),
  ]);
  if (!project) return notFound();

  // Pre-compute photo URLs on server
  const photoUrls: Record<string, { thumbnail: string; full: string }> = {};
  for (const photo of photos) {
    photoUrls[photo.id] = {
      thumbnail: getPhotoPublicUrl(photo.thumbnail_path),
      full: getPhotoPublicUrl(photo.file_path),
    };
  }

  const paidAmount = project.payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="pb-24">
      <ProjectHeader project={project} paidAmount={paidAmount} />

      {/* Status & Progress */}
      <div className="px-4 pb-3">
        <ProjectStatusControl
          projectId={project.id}
          currentStatus={project.status}
          currentProgress={project.progress}
        />
      </div>

      {/* Quotes for this project */}
      <div className="px-4 pb-3">
        <ProjectQuotesSection projectId={project.id} quotes={quotes} canCreate={canCreate} />
      </div>

      {/* Photos section */}
      <div className="px-4 pb-3">
        <div className="text-[13px] font-semibold text-ink-2 mb-2 tracking-wider">
          施工照片
          {photos.length > 0 && (
            <span className="text-ink-3 font-normal ml-1 font-mono">
              ({photos.length})
            </span>
          )}
        </div>
        <div className="bg-surface rounded-2xl border border-warm-border p-3 space-y-3">
          <PhotoGrid
            photos={photos}
            trades={project.trades}
            projectId={project.id}
            photoUrls={photoUrls}
          />
          <PhotoUpload
            projectId={project.id}
            trades={project.trades}
            remaining={photoQuota.remaining}
            allowed={photoQuota.allowed}
          />
        </div>
      </div>

      {/* Trades section */}
      <div className="px-4 pb-3">
        <div className="text-[13px] font-semibold text-ink-2 mb-2 tracking-wider">
          工種進度
        </div>
        {project.trades.length > 0 && (
          <div className="mb-3">
            <TradeList
              trades={project.trades}
              projectId={project.id}
              projectName={project.customer_name}
              projectAddress={project.address}
            />
          </div>
        )}
        <AddTradeForm projectId={project.id} />
      </div>

      {/* Payments section */}
      <div className="px-4 pb-3">
        <div className="text-[13px] font-semibold text-ink-2 mb-2 tracking-wider">
          收款進度
        </div>
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
