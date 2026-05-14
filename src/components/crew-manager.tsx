"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCrew, updateCrew, deleteCrew, toggleCrewVisibility } from "@/lib/actions";
import type { CrewRow } from "@/lib/database.types";

interface CrewFormState {
  name: string;
  role: string;
  phone: string;
}

const COMMON_ROLES = ["水電", "木工", "油漆", "泥作", "拆除", "鋁窗", "空調", "設備", "其他"];

export function CrewManager({ initialCrews }: Readonly<{ initialCrews: CrewRow[] }>) {
  const router = useRouter();
  const [crews, setCrews] = useState<CrewRow[]>(initialCrews);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(crews.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => router.refresh();

  const onCreate = async (form: CrewFormState) => {
    setError(null);
    try {
      const newCrew = await createCrew(form);
      setCrews((prev) => [...prev, newCrew as CrewRow]);
      setShowAdd(false);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增失敗");
    }
  };

  const onUpdate = async (id: string, form: CrewFormState) => {
    setError(null);
    try {
      await updateCrew(id, form);
      setCrews((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...form } : c))
      );
      setEditingId(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失敗");
    }
  };

  const onToggleVisibility = async (crew: CrewRow) => {
    const next = !crew.hidden_in_schedule;
    setCrews((prev) =>
      prev.map((c) => (c.id === crew.id ? { ...c, hidden_in_schedule: next } : c))
    );
    try {
      await toggleCrewVisibility(crew.id, next);
      refresh();
    } catch (e) {
      // rollback
      setCrews((prev) =>
        prev.map((c) =>
          c.id === crew.id ? { ...c, hidden_in_schedule: !next } : c
        )
      );
      setError(e instanceof Error ? e.message : "更新失敗");
    }
  };

  const onDelete = (crew: CrewRow) => {
    if (
      !globalThis.confirm(
        `確定要刪除「${crew.name}」嗎？相關工程的工班會變成未指定。`
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteCrew(crew.id);
        setCrews((prev) => prev.filter((c) => c.id !== crew.id));
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "刪除失敗");
      }
    });
  };

  return (
    <div className="pb-4">
      {error && (
        <div className="mx-4 mt-1 mb-2 px-3 py-2 rounded-xl bg-[var(--warm-red-soft)] text-[var(--warm-red)] text-xs">
          {error}
        </div>
      )}

      {/* Crew cards */}
      <div className="px-4 mt-1 space-y-2">
        {crews.map((crew) => {
          const isEditing = editingId === crew.id;
          return (
            <div
              key={crew.id}
              className="bg-surface rounded-2xl border border-warm-border p-3.5"
            >
              {isEditing ? (
                <CrewForm
                  initial={crew}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(form) => onUpdate(crew.id, form)}
                  submitLabel="更新"
                  pending={pending}
                />
              ) : (
                <CrewDisplay
                  crew={crew}
                  onEdit={() => setEditingId(crew.id)}
                  onDelete={() => onDelete(crew)}
                  onToggleVisibility={() => onToggleVisibility(crew)}
                />
              )}
            </div>
          );
        })}

        {crews.length === 0 && !showAdd && (
          <div className="text-center py-10 px-6">
            <div className="text-sm text-ink-2 mb-1">還沒有工班資料</div>
            <div className="text-xs text-ink-3">
              新增後在排程頁與案件頁就可以快速選擇
            </div>
          </div>
        )}
      </div>

      {/* Add form */}
      <div className="px-4 mt-2">
        {showAdd ? (
          <div className="bg-orange-soft rounded-2xl border border-orange/30 p-3.5">
            <CrewForm
              onCancel={() => setShowAdd(false)}
              onSubmit={onCreate}
              submitLabel="新增"
              pending={pending}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="w-full py-3 rounded-2xl border-2 border-dashed border-warm-border-strong bg-surface-warm text-sm font-medium text-ink-2"
          >
            + 新增工班
          </button>
        )}
      </div>
    </div>
  );
}

function CrewDisplay({
  crew,
  onEdit,
  onDelete,
  onToggleVisibility,
}: Readonly<{
  crew: CrewRow;
  onEdit: () => void;
  onDelete: () => void;
  onToggleVisibility: () => void;
}>) {
  const dimmed = crew.hidden_in_schedule;
  return (
    <div className={`flex items-center gap-3 ${dimmed ? "opacity-55" : ""}`}>
      <div
        className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-white font-bold text-sm"
        style={{
          background:
            "linear-gradient(135deg, #E2691F 0%, #A04428 100%)",
        }}
      >
        {crew.name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-bold text-ink truncate">{crew.name}</div>
        <div className="text-[11px] text-ink-3 truncate font-mono">
          {crew.role || "未分類"}
          {crew.phone ? ` · ${crew.phone}` : ""}
          {dimmed ? " · 已從排程隱藏" : ""}
        </div>
      </div>
      <div className="shrink-0 flex gap-1.5">
        <button
          type="button"
          onClick={onToggleVisibility}
          aria-label={dimmed ? "在排程顯示" : "從排程隱藏"}
          title={dimmed ? "在排程顯示" : "從排程隱藏"}
          className={`w-9 h-9 rounded-xl border flex items-center justify-center ${
            dimmed
              ? "bg-bg-warm border-warm-border text-ink-3"
              : "bg-surface-warm border-warm-border text-ink-2"
          }`}
        >
          {dimmed ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3l18 18M10 6a10 10 0 0 1 12 6 17 17 0 0 1-2.6 3.3M6.7 6.7C3.6 8.4 2 12 2 12s4 7 10 7a10 10 0 0 0 5.3-1.5" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
        {crew.phone && (
          <a
            href={`tel:${crew.phone}`}
            aria-label="撥打電話"
            className="w-9 h-9 rounded-xl bg-surface-warm border border-warm-border flex items-center justify-center text-ink-2"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 5a2 2 0 0 1 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a2 2 0 0 1-2 2A16 16 0 0 1 3 5z" />
            </svg>
          </a>
        )}
        <button
          type="button"
          onClick={onEdit}
          aria-label="編輯"
          className="w-9 h-9 rounded-xl bg-surface-warm border border-warm-border flex items-center justify-center text-ink-2"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="刪除"
          className="w-9 h-9 rounded-xl bg-[var(--warm-red-soft)] border border-[var(--warm-red)]/30 flex items-center justify-center text-[var(--warm-red)]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function CrewForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
  pending,
}: Readonly<{
  initial?: CrewRow;
  onSubmit: (form: CrewFormState) => void | Promise<void>;
  onCancel: () => void;
  submitLabel: string;
  pending: boolean;
}>) {
  const [form, setForm] = useState<CrewFormState>({
    name: initial?.name ?? "",
    role: initial?.role ?? "",
    phone: initial?.phone ?? "",
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        placeholder="師傅名稱（例：阿明、王師傅）"
        value={form.name}
        onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
        className="w-full px-3 py-2 rounded-lg bg-surface border border-warm-border text-sm focus:outline-none focus:border-orange"
      />

      <div className="flex gap-1.5 flex-wrap">
        {COMMON_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setForm((p) => ({ ...p, role: r }))}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              form.role === r
                ? "bg-orange text-white border-orange"
                : "bg-surface text-ink-2 border-warm-border"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {!COMMON_ROLES.includes(form.role) && (
        <input
          type="text"
          placeholder="工種（例：水電、木工）"
          value={form.role}
          onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
          className="w-full px-3 py-2 rounded-lg bg-surface border border-warm-border text-sm focus:outline-none focus:border-orange"
        />
      )}

      <input
        type="tel"
        inputMode="tel"
        placeholder="手機（例：0912-345-678）"
        value={form.phone}
        onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
        className="w-full px-3 py-2 rounded-lg bg-surface border border-warm-border text-sm focus:outline-none focus:border-orange"
      />

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting || pending}
          className="py-2 rounded-lg bg-surface border border-warm-border text-sm font-medium text-ink-2 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!form.name.trim() || submitting || pending}
          className="py-2 rounded-lg bg-orange text-white text-sm font-semibold disabled:opacity-50"
        >
          {submitting ? "處理中…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
