import { notFound } from "next/navigation";
import {
  getProject,
  getQuotesByProject,
  getLatestQuoteTotals,
  canCreateQuote,
  getPhotosByProject,
  canUploadPhoto,
  getPhotoPublicUrl,
  getCrews,
} from "@/lib/queries";
import { ProjectHeader } from "@/components/project-header";
import { ProjectDetailView } from "@/components/project-detail-view";

export const dynamic = "force-dynamic";

// Same-crew same-day conflict detection within this project
function detectConflictTradeIds(
  trades: { id: string; crew_id: string | null; crew: string; start_date: string | null }[]
): string[] {
  const dateCrewMap = new Map<string, string[]>();
  for (const t of trades) {
    if (!t.start_date) continue;
    const crewKey = t.crew_id ?? (t.crew?.trim() ? `name:${t.crew}` : null);
    if (!crewKey) continue;
    const key = `${t.start_date}::${crewKey}`;
    const existing = dateCrewMap.get(key) ?? [];
    dateCrewMap.set(key, [...existing, t.id]);
  }
  return Array.from(dateCrewMap.values())
    .filter((ids) => ids.length > 1)
    .flat();
}

export default async function ProjectDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const [project, quotes, profitTotals, canQuote, photos, photoQuota, crews] = await Promise.all([
    getProject(id),
    getQuotesByProject(id),
    getLatestQuoteTotals(id),
    canCreateQuote(),
    getPhotosByProject(id),
    canUploadPhoto(id),
    getCrews(),
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

  const conflictTradeIds = detectConflictTradeIds(project.trades);

  return (
    <div>
      <ProjectHeader
        project={project}
        trades={project.trades}
        profitEstimate={
          profitTotals
            ? { profit: profitTotals.profit, margin: profitTotals.margin }
            : null
        }
      />

      <ProjectDetailView
        project={project}
        trades={project.trades}
        payments={project.payments}
        quotes={quotes}
        photos={photos}
        photoUrls={photoUrls}
        photoQuota={photoQuota}
        crews={crews}
        canCreateQuote={canQuote}
        conflictTradeIds={conflictTradeIds}
      />
    </div>
  );
}
