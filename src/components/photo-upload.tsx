"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { compressPhoto, generateThumbnail } from "@/lib/image-compress";
import type { TradeRow } from "@/lib/database.types";

interface UploadStatus {
  fileName: string;
  status: "compressing" | "uploading" | "done" | "error";
  error?: string;
}

export function PhotoUpload({
  projectId,
  trades,
  remaining,
  allowed,
}: {
  projectId: string;
  trades: TradeRow[];
  remaining: number;
  allowed: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tradeId, setTradeId] = useState<string>("");
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Limit to remaining quota
    const fileList = Array.from(files).slice(0, remaining === Infinity ? files.length : remaining);

    setIsUploading(true);
    const statuses: UploadStatus[] = fileList.map((f) => ({
      fileName: f.name,
      status: "compressing" as const,
    }));
    setUploads(statuses);

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];

      try {
        // Compress
        setUploads((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, status: "compressing" } : u))
        );

        const [compressed, thumb] = await Promise.all([
          compressPhoto(file),
          generateThumbnail(file),
        ]);

        // Upload
        setUploads((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, status: "uploading" } : u))
        );

        const formData = new FormData();
        formData.append("projectId", projectId);
        if (tradeId) formData.append("tradeId", tradeId);
        formData.append("photo", compressed.blob, `photo.${compressed.mimeType === "image/webp" ? "webp" : "jpg"}`);
        formData.append("thumbnail", thumb.blob, `thumb.${thumb.mimeType === "image/webp" ? "webp" : "jpg"}`);

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

    // Clear after a short delay
    setTimeout(() => setUploads([]), 2000);

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!allowed) {
    return (
      <div className="text-center py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
        免費方案每個案件最多 100 張照片，請至帳號頁升級
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Trade selector + upload button */}
      <div className="flex gap-2">
        <select
          value={tradeId}
          onChange={(e) => setTradeId(e.target.value)}
          className="flex-1 px-3 py-2 rounded-xl border border-border text-xs bg-white focus:outline-none"
        >
          <option value="">一般（不分類）</option>
          {trades.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="shrink-0 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50 flex items-center gap-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          {isUploading ? "上傳中..." : "上傳照片"}
        </button>
      </div>

      {/* Remaining quota hint */}
      {remaining !== Infinity && (
        <div className="text-[10px] text-muted-foreground text-right">
          還可上傳 {remaining} 張
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
          {uploads.map((u, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="truncate flex-1">{u.fileName}</span>
              {u.status === "compressing" && (
                <span className="text-muted-foreground shrink-0">壓縮中...</span>
              )}
              {u.status === "uploading" && (
                <span className="text-primary shrink-0">上傳中...</span>
              )}
              {u.status === "done" && (
                <span className="text-sage-600 shrink-0">完成</span>
              )}
              {u.status === "error" && (
                <span className="text-destructive shrink-0">{u.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
