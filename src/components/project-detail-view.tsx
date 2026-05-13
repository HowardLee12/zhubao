"use client";

import { useState } from "react";
import { ProjectOverviewTab } from "@/components/project-overview-tab";
import { ProjectQuotesSection } from "@/components/project-quotes-section";
import { ProjectStatusControl } from "@/components/project-status-control";
import { TradeList } from "@/components/trade-list";
import { AddTradeForm } from "@/components/add-trade-form";
import { PaymentList } from "@/components/payment-list";
import { AddPaymentForm } from "@/components/add-payment-form";
import { PhotoGrid } from "@/components/photo-grid";
import { PhotoUpload } from "@/components/photo-upload";
import type {
  ProjectRow,
  TradeRow,
  PaymentRow,
  QuoteRow,
  PhotoRow,
  CrewRow,
} from "@/lib/database.types";

type Tab = "overview" | "quote" | "schedule" | "payment";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "概覽" },
  { id: "quote", label: "報價" },
  { id: "schedule", label: "排程" },
  { id: "payment", label: "收款" },
];

export function ProjectDetailView({
  project,
  trades,
  payments,
  quotes,
  photos,
  photoUrls,
  photoQuota,
  crews,
  canCreateQuote,
  conflictTradeIds,
}: Readonly<{
  project: ProjectRow;
  trades: TradeRow[];
  payments: PaymentRow[];
  quotes: QuoteRow[];
  photos: PhotoRow[];
  photoUrls: Record<string, { thumbnail: string; full: string }>;
  photoQuota: { allowed: boolean; remaining: number };
  crews: CrewRow[];
  canCreateQuote: boolean;
  conflictTradeIds: string[];
}>) {
  const [tab, setTab] = useState<Tab>("overview");
  const conflictSet = new Set(conflictTradeIds);
  const crewNamesById: Record<string, { name: string; role: string; phone: string }> = {};
  for (const c of crews) {
    crewNamesById[c.id] = { name: c.name, role: c.role, phone: c.phone };
  }

  return (
    <div className="pb-24">
      {/* Sub-tabs */}
      <div className="px-4 mt-1 mb-3">
        <div className="flex gap-1 p-1 bg-bg-warm rounded-xl">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all ${
                tab === t.id
                  ? "bg-surface text-orange shadow-sm"
                  : "text-ink-3"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="px-4">
        {tab === "overview" && (
          <ProjectOverviewTab
            projectId={project.id}
            trades={trades}
            payments={payments}
            photos={photos}
            photoUrls={photoUrls}
            conflictTradeIds={conflictSet}
            crewNamesById={crewNamesById}
            onSwitchToTab={(target) => setTab(target)}
          />
        )}

        {tab === "quote" && (
          <div className="space-y-3">
            <ProjectQuotesSection
              projectId={project.id}
              quotes={quotes}
              canCreate={canCreateQuote}
            />
          </div>
        )}

        {tab === "schedule" && (
          <div className="space-y-3">
            <ProjectStatusControl
              projectId={project.id}
              currentStatus={project.status}
              currentProgress={project.progress}
            />

            {trades.length > 0 && (
              <TradeList
                trades={trades}
                projectId={project.id}
                projectName={project.customer_name}
                projectAddress={project.address}
              />
            )}
            <AddTradeForm projectId={project.id} crews={crews} />

            <div className="pt-2">
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
                  trades={trades}
                  projectId={project.id}
                  photoUrls={photoUrls}
                />
                <PhotoUpload
                  projectId={project.id}
                  trades={trades}
                  remaining={photoQuota.remaining}
                  allowed={photoQuota.allowed}
                />
              </div>
            </div>
          </div>
        )}

        {tab === "payment" && (
          <div className="space-y-3">
            {payments.length > 0 && (
              <PaymentList
                payments={payments}
                projectId={project.id}
                totalAmount={project.total_amount}
              />
            )}
            <AddPaymentForm
              projectId={project.id}
              totalAmount={project.total_amount}
            />
          </div>
        )}
      </div>
    </div>
  );
}
