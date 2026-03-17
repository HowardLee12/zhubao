"use client";

import { useState, useMemo } from "react";
import { PhotoLightbox } from "@/components/photo-lightbox";
import type { PhotoRow, TradeRow } from "@/lib/database.types";

interface PhotoGridProps {
  photos: PhotoRow[];
  trades: TradeRow[];
  projectId: string;
  photoUrls: Record<string, { thumbnail: string; full: string }>;
}

export function PhotoGrid({ photos, trades, projectId, photoUrls }: PhotoGridProps) {
  const [filter, setFilter] = useState<string>("all");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Build trade name map
  const tradeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of trades) {
      map.set(t.id, t.name);
    }
    return map;
  }, [trades]);

  // Get unique trade IDs that have photos
  const tradeFilters = useMemo(() => {
    const tradeIds = new Set<string>();
    let hasUntagged = false;
    for (const p of photos) {
      if (p.trade_id) tradeIds.add(p.trade_id);
      else hasUntagged = true;
    }
    const filters: { id: string; label: string }[] = [];
    for (const id of tradeIds) {
      const name = tradeMap.get(id);
      if (name) filters.push({ id, label: name });
    }
    if (hasUntagged) filters.push({ id: "none", label: "一般" });
    return filters;
  }, [photos, tradeMap]);

  // Filter photos
  const filtered = useMemo(() => {
    if (filter === "all") return photos;
    if (filter === "none") return photos.filter((p) => !p.trade_id);
    return photos.filter((p) => p.trade_id === filter);
  }, [photos, filter]);

  if (photos.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-xs">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2 opacity-40">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        尚未上傳施工照片
      </div>
    );
  }

  return (
    <>
      {/* Filter tabs */}
      {tradeFilters.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2">
          <button
            onClick={() => setFilter("all")}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
              filter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-sage-100 text-sage-600"
            }`}
          >
            全部 {photos.length}
          </button>
          {tradeFilters.map((tf) => {
            const count = tf.id === "none"
              ? photos.filter((p) => !p.trade_id).length
              : photos.filter((p) => p.trade_id === tf.id).length;
            return (
              <button
                key={tf.id}
                onClick={() => setFilter(tf.id)}
                className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  filter === tf.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-sage-100 text-sage-600"
                }`}
              >
                {tf.label} {count}
              </button>
            );
          })}
        </div>
      )}

      {/* Thumbnail grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {filtered.map((photo, index) => {
          const urls = photoUrls[photo.id];
          if (!urls) return null;

          return (
            <button
              key={photo.id}
              onClick={() => setLightboxIndex(index)}
              className="relative aspect-square rounded-lg overflow-hidden bg-sage-100"
            >
              <img
                src={urls.thumbnail}
                alt={photo.caption || "施工照片"}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {photo.trade_id && tradeMap.get(photo.trade_id) && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1.5 py-0.5 truncate">
                  {tradeMap.get(photo.trade_id)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && filtered[lightboxIndex] && (
        <PhotoLightbox
          photo={{
            id: filtered[lightboxIndex].id,
            fullUrl: photoUrls[filtered[lightboxIndex].id]?.full ?? "",
            tradeName: filtered[lightboxIndex].trade_id
              ? tradeMap.get(filtered[lightboxIndex].trade_id!) ?? null
              : null,
            caption: filtered[lightboxIndex].caption,
            createdAt: filtered[lightboxIndex].created_at,
            projectId,
          }}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((prev) => Math.max(0, (prev ?? 0) - 1))}
          onNext={() => setLightboxIndex((prev) => Math.min(filtered.length - 1, (prev ?? 0) + 1))}
          hasPrev={lightboxIndex > 0}
          hasNext={lightboxIndex < filtered.length - 1}
        />
      )}
    </>
  );
}
