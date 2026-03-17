"use client";

import { useState } from "react";
import { addTrade } from "@/lib/actions";
import { useRouter } from "next/navigation";

const COMMON_TRADES = [
  "拆除", "水電", "泥作", "木作", "油漆",
  "鋁窗", "系統櫃", "廚具", "衛浴", "地板", "清潔",
];

export function AddTradeForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [crew, setCrew] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await addTrade({
        projectId,
        name: name.trim(),
        crew: crew.trim(),
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setName("");
      setCrew("");
      setStartDate("");
      setEndDate("");
      setOpen(false);
      router.refresh();
    } catch {
      // error silently handled
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2.5 border-2 border-dashed border-sage-300 rounded-xl text-sm text-sage-500 font-medium"
      >
        + 新增工種排程
      </button>
    );
  }

  return (
    <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
      <div className="text-sm font-semibold text-sage-800">新增工種</div>

      <div className="flex flex-wrap gap-1.5">
        {COMMON_TRADES.map((t) => (
          <button
            key={t}
            onClick={() => setName(t)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
              name === t
                ? "bg-primary text-primary-foreground"
                : "bg-sage-50 text-sage-600 hover:bg-sage-100"
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
        className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
      />

      <input
        type="text"
        value={crew}
        onChange={(e) => setCrew(e.target.value)}
        placeholder="工班名稱（例：王師傅）"
        className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
      />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground">開始日期</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">結束日期</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setOpen(false)}
          className="flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !name.trim()}
          className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {submitting ? "新增中..." : "新增"}
        </button>
      </div>
    </div>
  );
}
