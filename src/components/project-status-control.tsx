"use client";

import { useState } from "react";
import { updateProject } from "@/lib/actions";
import { useRouter } from "next/navigation";

const STATUSES = [
  { value: "planning", label: "規劃中" },
  { value: "in_progress", label: "施工中" },
  { value: "completed", label: "已完工" },
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
    let newProgress = progress;
    if (newStatus === "completed") newProgress = 100;
    else if (newStatus === "planning") newProgress = 0;
    setProgress(newProgress);
    setSaving(true);
    try {
      await updateProject(projectId, {
        status: newStatus,
        progress: newProgress,
      });
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
    <div className="bg-surface rounded-2xl border border-warm-border p-4 space-y-3">
      <div className="flex gap-1 p-1 bg-bg-warm rounded-xl">
        {STATUSES.map((s) => {
          const active = status === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => handleStatusChange(s.value)}
              disabled={saving}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                active
                  ? "bg-surface text-orange shadow-sm"
                  : "text-ink-2"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

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
            className="flex-1 h-2 appearance-none bg-bg-warm rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow"
          />
          <span className="text-sm font-bold text-orange min-w-[40px] text-right font-mono tabular-nums">
            {progress}%
          </span>
        </div>
      )}
    </div>
  );
}
