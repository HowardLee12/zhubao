"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deletePhoto } from "@/lib/actions";
import { formatDate } from "@/lib/format";

interface LightboxPhoto {
  id: string;
  fullUrl: string;
  tradeName: string | null;
  caption: string;
  createdAt: string;
  projectId: string;
}

export function PhotoLightbox({
  photo,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  photo: LightboxPhoto;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!globalThis.confirm("確定要刪除這張照片嗎？")) return;

    setDeleting(true);
    try {
      await deletePhoto(photo.id, photo.projectId);
      router.refresh();
      onClose();
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col"
      onClick={onClose}
    >
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 shrink-0" onClick={(e) => e.stopPropagation()}>
        <div className="text-white text-xs">
          {photo.tradeName && (
            <span className="bg-white/20 px-2 py-0.5 rounded-full mr-2">{photo.tradeName}</span>
          )}
          {formatDate(photo.createdAt)}
        </div>
        <button onClick={onClose} className="text-white text-lg font-bold px-2">
          {"✕"}
        </button>
      </div>

      {/* Image area */}
      <div className="flex-1 flex items-center justify-center relative min-h-0 px-2">
        {/* Previous button */}
        {hasPrev && (
          <button
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-white/70 text-3xl z-10 px-2"
          >
            {"<"}
          </button>
        )}

        <img
          src={photo.fullUrl}
          alt={photo.caption || "施工照片"}
          className="max-w-full max-h-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />

        {/* Next button */}
        {hasNext && (
          <button
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/70 text-3xl z-10 px-2"
          >
            {">"}
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-4 py-3 flex justify-center" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-red-400 text-xs font-medium disabled:opacity-50"
        >
          {deleting ? "刪除中..." : "刪除照片"}
        </button>
      </div>
    </div>
  );
}
