"use client";

import { useState } from "react";
import { updateProject } from "@/lib/actions";
import { useRouter } from "next/navigation";

const STATUSES = [
  { value: "planning", label: "規劃中", className: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "in_progress", label: "施工中", className: "bg-sage-100 text-sage-700 border-sage-200" },
  { value: "completed", label: "已完工", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
] as const;

type ProjectStatus = "planning" | "in_progress" | "completed";

export function ProjectStatusControl({
  projectId,
  currentStatus,
  currentProgress,
}: {
  projectId: string;
  currentStatus: ProjectStatus;
  currentProgress: number;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ProjectStatus>(currentStatus);
  const [progress, setProgress] = useState(currentProgress);
  const [saving, setSaving] = useState(false);

  const handleStatusChange = async (newStatus: ProjectStatus) => {
    setStatus(newStatus);
    const newProgress = newStatus === "completed" ? 100 : newStatus === "planning" ? 0 : progress;
    setProgress(newProgress);
    setSaving(true);
    try {
      await updateProject(projectId, { status: newStatus, progress: newProgress });
      router.refresh();
    } catch {
      setStatus(currentStatus);
      setProgress(currentProgress);
    } finally {
      setSaving(false);
    }
  };

  const handleProgressChange = async (newProgress: number) => {
    setProgress(newProgress);
    setSaving(true);
    try {
      await updateProject(projectId, { progress: newProgress });
      router.refresh();
    } catch {
      setProgress(currentProgress);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Status pills */}
      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => handleStatusChange(s.value)}
            disabled={saving}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${
              status === s.value
                ? s.className
                : "bg-white text-muted-foreground border-border"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Progress slider */}
      {status !== "completed" && (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            onMouseUp={() => handleProgressChange(progress)}
            onTouchEnd={() => handleProgressChange(progress)}
            className="flex-1 h-2 appearance-none bg-sage-100 rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer"
          />
          <span className="text-sm font-bold text-primary min-w-[40px] text-right">
            {progress}%
          </span>
        </div>
      )}
    </div>
  );
}
