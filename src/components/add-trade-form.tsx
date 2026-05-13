"use client";

import { useState } from "react";
import { addTrade, createCrew } from "@/lib/actions";
import { useRouter } from "next/navigation";
import type { CrewRow } from "@/lib/database.types";

const COMMON_TRADES = [
  "拆除", "水電", "泥作", "木作", "油漆",
  "鋁窗", "系統櫃", "廚具", "衛浴", "地板", "清潔",
];

export function AddTradeForm({
  projectId,
  crews,
}: Readonly<{
  projectId: string;
  crews: CrewRow[];
}>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null);
  const [crewList, setCrewList] = useState<CrewRow[]>(crews);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [newCrewMode, setNewCrewMode] = useState(false);
  const [newCrewName, setNewCrewName] = useState("");
  const [newCrewRole, setNewCrewRole] = useState("");
  const [newCrewPhone, setNewCrewPhone] = useState("");

  const reset = () => {
    setName("");
    setSelectedCrewId(null);
    setStartDate("");
    setEndDate("");
    setNewCrewMode(false);
    setNewCrewName("");
    setNewCrewRole("");
    setNewCrewPhone("");
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const selectedCrew = crewList.find((c) => c.id === selectedCrewId);
      await addTrade({
        projectId,
        name: name.trim(),
        crew: selectedCrew?.name ?? "",
        crewId: selectedCrew?.id ?? null,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      reset();
      setOpen(false);
      router.refresh();
    } catch {
      // error silently handled
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCrew = async () => {
    if (!newCrewName.trim()) return;
    setSubmitting(true);
    try {
      const created = (await createCrew({
        name: newCrewName.trim(),
        role: newCrewRole.trim(),
        phone: newCrewPhone.trim(),
      })) as CrewRow;
      setCrewList((prev) => [...prev, created]);
      setSelectedCrewId(created.id);
      setNewCrewMode(false);
      setNewCrewName("");
      setNewCrewRole("");
      setNewCrewPhone("");
    } catch {
      // surface inline error via disable
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full py-2.5 border-2 border-dashed border-warm-border-strong bg-surface-warm rounded-xl text-sm text-ink-2 font-medium"
      >
        + 新增工種排程
      </button>
    );
  }

  return (
    <div className="bg-surface rounded-2xl border border-warm-border p-4 space-y-3">
      <div className="text-sm font-semibold text-ink">新增工種</div>

      {/* Trade name quick chips */}
      <div className="flex flex-wrap gap-1.5">
        {COMMON_TRADES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setName(t)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
              name === t
                ? "bg-orange text-white"
                : "bg-bg-warm text-ink-2"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="工種名稱"
        className="w-full px-3 py-2 rounded-lg border border-warm-border text-sm focus:outline-none focus:border-orange"
      />

      {/* Crew picker */}
      <div>
        <div className="text-[11px] text-ink-3 mb-1.5 font-medium">工班</div>
        {newCrewMode ? (
          <div className="bg-orange-soft border border-orange/30 rounded-xl p-2.5 space-y-2">
            <input
              type="text"
              value={newCrewName}
              onChange={(e) => setNewCrewName(e.target.value)}
              placeholder="師傅名稱（例：阿明）"
              className="w-full px-3 py-1.5 rounded-lg border border-warm-border bg-surface text-sm focus:outline-none focus:border-orange"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="text"
                value={newCrewRole}
                onChange={(e) => setNewCrewRole(e.target.value)}
                placeholder="工種"
                className="px-3 py-1.5 rounded-lg border border-warm-border bg-surface text-sm focus:outline-none focus:border-orange"
              />
              <input
                type="tel"
                value={newCrewPhone}
                onChange={(e) => setNewCrewPhone(e.target.value)}
                placeholder="電話"
                className="px-3 py-1.5 rounded-lg border border-warm-border bg-surface text-sm focus:outline-none focus:border-orange"
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setNewCrewMode(false)}
                disabled={submitting}
                className="py-1.5 rounded-lg bg-surface border border-warm-border text-xs"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateCrew}
                disabled={submitting || !newCrewName.trim()}
                className="py-1.5 rounded-lg bg-orange text-white text-xs font-semibold disabled:opacity-50"
              >
                建立並選用
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedCrewId(null)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
                selectedCrewId === null
                  ? "bg-ink text-white border-ink"
                  : "bg-surface text-ink-3 border-warm-border"
              }`}
            >
              未指定
            </button>
            {crewList.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCrewId(c.id)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
                  selectedCrewId === c.id
                    ? "bg-orange text-white border-orange"
                    : "bg-surface text-ink-2 border-warm-border"
                }`}
              >
                {c.name}
                {c.role && <span className="opacity-65 ml-1">· {c.role}</span>}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setNewCrewMode(true)}
              className="text-xs px-2.5 py-1 rounded-full font-medium border border-dashed border-orange text-orange"
            >
              + 新增工班
            </button>
          </div>
        )}
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-ink-3">開始日期</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-warm-border text-sm focus:outline-none focus:border-orange"
          />
        </div>
        <div>
          <label className="text-[10px] text-ink-3">結束日期</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-warm-border text-sm focus:outline-none focus:border-orange"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={submitting}
          className="flex-1 py-2 rounded-lg border border-warm-border text-sm text-ink-2 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !name.trim()}
          className="flex-1 py-2 rounded-lg bg-orange text-white text-sm font-semibold disabled:opacity-50"
        >
          {submitting ? "新增中..." : "新增"}
        </button>
      </div>
    </div>
  );
}
