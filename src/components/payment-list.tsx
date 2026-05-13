"use client";

import { useState } from "react";
import { updatePaymentStatus, deletePayment } from "@/lib/actions";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/format";
import { Pill } from "@/components/ui/pill";
import type { PaymentRow } from "@/lib/database.types";

type PaymentStatus = "paid" | "due" | "upcoming" | "pending";

const STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "pending", label: "待收" },
  { value: "upcoming", label: "即將到期" },
  { value: "due", label: "已到期" },
  { value: "paid", label: "已收款" },
];

const dotClass: Record<PaymentStatus, string> = {
  paid: "bg-[var(--warm-green)] border-[var(--warm-green)]",
  due: "bg-[var(--warm-red)] border-[var(--warm-red)] animate-pulse",
  upcoming: "bg-amber border-amber",
  pending: "bg-surface border-warm-border-strong",
};

const amountColor: Record<PaymentStatus, string> = {
  paid: "text-[var(--warm-green)]",
  due: "text-[var(--warm-red)]",
  upcoming: "text-orange-deep",
  pending: "text-ink-2",
};

const pillVariant: Record<PaymentStatus, "green" | "red" | "amber" | "neutral"> = {
  paid: "green",
  due: "red",
  upcoming: "amber",
  pending: "neutral",
};

function PaymentTimelineRow({
  payment,
  index,
  isLast,
  onStatusChange,
  onDelete,
  isUpdating,
  isDeleting,
}: Readonly<{
  payment: PaymentRow;
  index: number;
  isLast: boolean;
  onStatusChange: (p: PaymentRow, s: PaymentStatus) => void;
  onDelete: (p: PaymentRow) => void;
  isUpdating: boolean;
  isDeleting: boolean;
}>) {
  const status = payment.status;
  const dateLabel = (() => {
    if (payment.paid_date) return `${formatDate(payment.paid_date)} 已收`;
    if (payment.due_date) return `預計 ${formatDate(payment.due_date)}`;
    return "待定";
  })();

  return (
    <div className="flex gap-3 items-stretch py-1.5">
      {/* Rail */}
      <div className="w-5 flex flex-col items-center shrink-0">
        <div
          className={`w-3.5 h-3.5 rounded-full border-2 mt-3 shrink-0 ${dotClass[status]}`}
        />
        {!isLast && (
          <div
            className={`flex-1 w-px ${
              status === "paid" ? "bg-[var(--warm-green)]/40" : "bg-warm-border"
            }`}
          />
        )}
      </div>

      {/* Card */}
      <div className="flex-1 bg-surface border border-warm-border rounded-2xl p-3 mb-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-ink">
              第 {index + 1} 期 · {payment.name}
            </div>
            <div className="text-[11px] text-ink-3 mt-0.5 font-mono">
              {payment.percentage}% · {dateLabel}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div
              className={`font-mono text-base font-bold tabular-nums ${amountColor[status]}`}
            >
              {formatCurrency(payment.amount)}
            </div>
            <div className="mt-1">
              <Pill variant={pillVariant[status]}>
                {STATUS_OPTIONS.find((s) => s.value === status)?.label}
              </Pill>
            </div>
          </div>
        </div>

        {(status === "due" || status === "upcoming") && (
          <div className="mt-2.5 pt-2.5 border-t border-dashed border-warm-border grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onStatusChange(payment, "paid")}
              disabled={isUpdating}
              className="py-2 rounded-lg bg-orange-soft text-orange-deep text-xs font-semibold disabled:opacity-50"
            >
              {isUpdating ? "更新中…" : "標記已收"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (globalThis.confirm(`確定要刪除「${payment.name}」嗎？`)) {
                  onDelete(payment);
                }
              }}
              disabled={isDeleting}
              className="py-2 rounded-lg bg-bg-warm text-ink-2 text-xs font-medium disabled:opacity-50"
            >
              {isDeleting ? "刪除中…" : "刪除"}
            </button>
          </div>
        )}

        {status === "pending" && (
          <div className="mt-2.5 pt-2.5 border-t border-dashed border-warm-border flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (globalThis.confirm(`確定要刪除「${payment.name}」嗎？`)) {
                  onDelete(payment);
                }
              }}
              disabled={isDeleting}
              className="text-xs text-ink-3 hover:text-[var(--warm-red)]"
            >
              {isDeleting ? "刪除中…" : "刪除"}
            </button>
          </div>
        )}

        {/* Hidden quick-set status dropdown for power users */}
        {status !== "paid" && (
          <div className="mt-2">
            <select
              value={status}
              onChange={(e) =>
                onStatusChange(payment, e.target.value as PaymentStatus)
              }
              disabled={isUpdating}
              className="w-full text-[11px] py-1 rounded-md border border-warm-border bg-surface-warm text-ink-2"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  狀態：{opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

export function PaymentList({
  payments,
  projectId,
  totalAmount,
}: Readonly<{
  payments: PaymentRow[];
  projectId: string;
  totalAmount: number;
}>) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paidAmount = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);
  const dueAmount = Math.max(0, totalAmount - paidAmount);
  const paidPct = totalAmount > 0 ? Math.round((paidAmount / totalAmount) * 100) : 0;

  const handleStatusChange = async (payment: PaymentRow, newStatus: PaymentStatus) => {
    if (newStatus === payment.status) return;
    setUpdatingId(payment.id);
    setError(null);
    try {
      await updatePaymentStatus(payment.id, newStatus);
      router.refresh();
    } catch {
      setError("狀態更新失敗，請重試");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (payment: PaymentRow) => {
    setDeletingId(payment.id);
    setError(null);
    try {
      await deletePayment(payment.id, projectId);
      router.refresh();
    } catch {
      setError("刪除失敗，請重試");
    } finally {
      setDeletingId(null);
    }
  };

  if (payments.length === 0) return null;

  return (
    <div>
      {/* Summary card */}
      <div className="bg-surface rounded-2xl border border-warm-border p-4 mb-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-ink-2 font-medium">已收 / 總價</span>
          <span className="text-xs text-ink-3 font-mono">
            {paidPct}%
          </span>
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="font-mono text-2xl font-bold text-[var(--warm-green)] tabular-nums">
            {formatCurrency(paidAmount)}
          </span>
          <span className="font-mono text-sm text-ink-3 tabular-nums">
            / {formatCurrency(totalAmount)}
          </span>
        </div>
        <div className="h-2 rounded-full bg-bg-warm overflow-hidden mt-2">
          <div
            className="h-full bg-[var(--warm-green)] rounded-full transition-all"
            style={{ width: `${paidPct}%` }}
          />
        </div>
        {dueAmount > 0 && (
          <div className="text-[11px] text-orange-deep mt-1.5 font-mono">
            待收 {formatCurrency(dueAmount)}
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-[var(--warm-red)] text-center mb-2">
          {error}
        </div>
      )}

      {/* Timeline */}
      <div>
        {payments.map((p, i) => (
          <PaymentTimelineRow
            key={p.id}
            payment={p}
            index={i}
            isLast={i === payments.length - 1}
            onStatusChange={handleStatusChange}
            onDelete={handleDelete}
            isUpdating={updatingId === p.id}
            isDeleting={deletingId === p.id}
          />
        ))}
      </div>
    </div>
  );
}
