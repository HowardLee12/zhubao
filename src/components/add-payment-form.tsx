"use client";

import { useState } from "react";
import { addPayment } from "@/lib/actions";
import { useRouter } from "next/navigation";

const COMMON_PAYMENTS = [
  { name: "簽約金", percentage: 30 },
  { name: "開工款", percentage: 30 },
  { name: "中期款", percentage: 20 },
  { name: "完工款", percentage: 20 },
];

export function AddPaymentForm({
  projectId,
  totalAmount,
}: {
  projectId: string;
  totalAmount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [percentage, setPercentage] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const amount = Math.round(totalAmount * (percentage / 100));

  const selectTemplate = (template: { name: string; percentage: number }) => {
    setName(template.name);
    setPercentage(template.percentage);
  };

  const handleSubmit = async () => {
    if (!name.trim() || percentage <= 0) return;
    setSubmitting(true);
    try {
      await addPayment({
        projectId,
        name: name.trim(),
        percentage,
        amount,
        dueDate: dueDate || undefined,
      });
      setName("");
      setPercentage(0);
      setDueDate("");
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
        + 新增收款期數
      </button>
    );
  }

  return (
    <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
      <div className="text-sm font-semibold text-sage-800">新增收款期數</div>

      <div className="flex flex-wrap gap-1.5">
        {COMMON_PAYMENTS.map((t) => (
          <button
            key={t.name}
            onClick={() => selectTemplate(t)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
              name === t.name
                ? "bg-primary text-primary-foreground"
                : "bg-sage-50 text-sage-600 hover:bg-sage-100"
            }`}
          >
            {t.name} {t.percentage}%
          </button>
        ))}
      </div>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="期數名稱"
        className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
      />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground">比例 %</label>
          <input
            type="number"
            value={percentage}
            onChange={(e) => setPercentage(Number(e.target.value))}
            min={0}
            max={100}
            className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">預計收款日</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>

      {percentage > 0 && (
        <div className="text-xs text-sage-600 font-medium">
          金額：NT${amount.toLocaleString("zh-TW")}（{percentage}% of NT${totalAmount.toLocaleString("zh-TW")}）
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => setOpen(false)}
          className="flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !name.trim() || percentage <= 0}
          className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {submitting ? "新增中..." : "新增"}
        </button>
      </div>
    </div>
  );
}
