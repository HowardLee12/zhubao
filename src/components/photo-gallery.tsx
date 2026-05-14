"use client";

import { useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { compressPhoto, generateThumbnail } from "@/lib/image-compress";
import { PhotoLightbox } from "@/components/photo-lightbox";
import type { PhotoRow, TradeRow } from "@/lib/database.types";

interface UploadStatus {
  fileName: string;
  status: "compressing" | "uploading" | "done" | "error";
  error?: string;
}

export function PhotoGallery({
  projectId,
  photos,
  trades,
  photoUrls,
  remaining,
  allowed,
}: Readonly<{
  projectId: string;
  photos: PhotoRow[];
  trades: TradeRow[];
  photoUrls: Record<string, { thumbnail: string; full: string }>;
  remaining: number;
  allowed: boolean;
}>) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tradeId, setTradeId] = useState<string>("");
  const [filter, setFilter] = useState<string>("all");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);

  const tradeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of trades) m.set(t.id, t.name);
    return m;
  }, [trades]);

  const tradeFilters = useMemo(() => {
    const tradeIds = new Set<string>();
    let hasUntagged = false;
    for (const p of photos) {
      if (p.trade_id) tradeIds.add(p.trade_id);
      else hasUntagged = true;
    }
    const list: { id: string; label: string; count: number }[] = [];
    for (const id of tradeIds) {
      const name = tradeMap.get(id);
      if (name) {
        list.push({
          id,
          label: name,
          count: photos.filter((p) => p.trade_id === id).length,
        });
      }
    }
    if (hasUntagged) {
      list.push({
        id: "none",
        label: "一般",
        count: photos.filter((p) => !p.trade_id).length,
      });
    }
    return list;
  }, [photos, tradeMap]);

  const filtered = useMemo(() => {
    if (filter === "all") return photos;
    if (filter === "none") return photos.filter((p) => !p.trade_id);
    return photos.filter((p) => p.trade_id === filter);
  }, [photos, filter]);

  const triggerUpload = () => {
    if (!allowed) return;
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files).slice(
      0,
      remaining === Infinity ? files.length : remaining
    );

    setIsUploading(true);
    setUploads(
      fileList.map((f) => ({ fileName: f.name, status: "compressing" }))
    );

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        setUploads((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, status: "compressing" } : u))
        );
        const [compressed, thumb] = await Promise.all([
          compressPhoto(file),
          generateThumbnail(file),
        ]);

        setUploads((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, status: "uploading" } : u))
        );

        const formData = new FormData();
        formData.append("projectId", projectId);
        if (tradeId) formData.append("tradeId", tradeId);
        formData.append(
          "photo",
          compressed.blob,
          `photo.${compressed.mimeType === "image/webp" ? "webp" : "jpg"}`
        );
        formData.append(
          "thumbnail",
          thumb.blob,
          `thumb.${thumb.mimeType === "image/webp" ? "webp" : "jpg"}`
        );

        const res = await fetch("/api/photos/upload", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "上傳失敗");
        }

        setUploads((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, status: "done" } : u))
        );
      } catch (err) {
        setUploads((prev) =>
          prev.map((u, idx) =>
            idx === i
              ? { ...u, status: "error", error: err instanceof Error ? err.message : "上傳失敗" }
              : u
          )
        );
      }
    }

    setIsUploading(false);
    router.refresh();
    globalThis.setTimeout(() => setUploads([]), 2000);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Choose label shown inside the upload tile
  const uploadTileLabel = isUploading
    ? "上傳中…"
    : tradeId
    ? `+ 拍照（${tradeMap.get(tradeId) ?? "一般"}）`
    : "+ 拍照";

  return (
    <div className="space-y-2.5">
      {/* Filter pills (only when 2+ categories) */}
      {tradeFilters.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
              filter === "all"
                ? "bg-orange text-white"
                : "bg-bg-warm text-ink-2"
            }`}
          >
            全部 {photos.length}
          </button>
          {tradeFilters.map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setFilter(tf.id)}
              className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                filter === tf.id
                  ? "bg-orange text-white"
                  : "bg-bg-warm text-ink-2"
              }`}
            >
              {tf.label} {tf.count}
            </button>
          ))}
        </div>
      )}

      {/* Photo grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {filtered.map((photo, index) => {
          const urls = photoUrls[photo.id];
          if (!urls) return null;
          const tradeName = photo.trade_id ? tradeMap.get(photo.trade_id) : null;
          return (
            <button
              type="button"
              key={photo.id}
              onClick={() => setLightboxIndex(index)}
              className="relative aspect-square rounded-lg overflow-hidden bg-bg-warm border border-warm-border"
            >
              <img
                src={urls.thumbnail}
                alt={photo.caption || "施工照片"}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {tradeName && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1.5 py-0.5 truncate">
                  {tradeName}
                </div>
              )}
            </button>
          );
        })}

        {/* + 拍照 tile (last) */}
        {allowed ? (
          <button
            type="button"
            onClick={triggerUpload}
            disabled={isUploading}
            className="aspect-square rounded-lg border-2 border-dashed border-orange/50 bg-orange-soft text-orange-deep flex flex-col items-center justify-center gap-1 text-[11px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            <span className="px-1 text-center leading-tight">{uploadTileLabel}</span>
          </button>
        ) : (
          <div className="aspect-square rounded-lg bg-bg-warm border border-warm-border flex items-center justify-center text-center text-[10px] text-ink-3 px-2 leading-tight">
            照片已達上限
          </div>
        )}
      </div>

      {/* Trade tagging (collapsed by default) */}
      {trades.length > 0 && allowed && (
        <div>
          {showTagPicker ? (
            <div className="bg-surface-warm rounded-xl border border-warm-border p-2 space-y-2">
              <div className="text-[11px] text-ink-3 font-medium">
                這次拍照要分類到哪個工種？
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setTradeId("")}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                    tradeId === ""
                      ? "bg-orange text-white border-orange"
                      : "bg-surface text-ink-2 border-warm-border"
                  }`}
                >
                  一般
                </button>
                {trades.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setTradeId(t.id)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                      tradeId === t.id
                        ? "bg-orange text-white border-orange"
                        : "bg-surface text-ink-2 border-warm-border"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowTagPicker(false)}
                className="text-[11px] text-ink-3"
              >
                收起
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowTagPicker(true)}
              className="text-[11px] text-ink-3"
            >
              {tradeId ? `分類：${tradeMap.get(tradeId) ?? "一般"} ›` : "設定拍照分類 ›"}
            </button>
          )}
        </div>
      )}

      {/* Remaining quota hint */}
      {allowed && remaining !== Infinity && (
        <div className="text-[10px] text-ink-3 text-right">
          還可上傳 {remaining} 張
        </div>
      )}

      {!allowed && (
        <div className="text-center py-2 bg-amber-soft border border-amber/40 rounded-xl text-xs text-amber">
          照片配額用完，請至帳號頁升級
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="space-y-1">
          {uploads.map((u) => (
            <div key={u.fileName} className="flex items-center gap-2 text-xs">
              <span className="truncate flex-1 text-ink-2">{u.fileName}</span>
              {u.status === "compressing" && (
                <span className="text-ink-3 shrink-0">壓縮中…</span>
              )}
              {u.status === "uploading" && (
                <span className="text-orange shrink-0">上傳中…</span>
              )}
              {u.status === "done" && (
                <span className="text-[var(--warm-green)] shrink-0">完成</span>
              )}
              {u.status === "error" && (
                <span className="text-[var(--warm-red)] shrink-0">{u.error}</span>
              )}
            </div>
          ))}
        </div>
      )}

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
          onPrev={() =>
            setLightboxIndex((prev) => Math.max(0, (prev ?? 0) - 1))
          }
          onNext={() =>
            setLightboxIndex((prev) =>
              Math.min(filtered.length - 1, (prev ?? 0) + 1)
            )
          }
          hasPrev={lightboxIndex > 0}
          hasNext={lightboxIndex < filtered.length - 1}
        />
      )}
    </div>
  );
}
