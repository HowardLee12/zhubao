"use client";

import { useState } from "react";
import { updatePaymentStatus, deletePayment } from "@/lib/actions";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/format";
import type { PaymentRow } from "@/lib/database.types";

type PaymentStatus = "paid" | "due" | "upcoming" | "pending";

const PAYMENT_STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "pending", label: "待收" },
  { value: "upcoming", label: "即將到期" },
  { value: "due", label: "已到期" },
  { value: "paid", label: "已收款" },
];

const paymentSelectStyle: Record<PaymentStatus, string> = {
  paid: "bg-sage-50 text-sage-700 border-sage-200",
  due: "bg-red-50 text-red-700 border-red-200",
  upcoming: "bg-amber-50 text-amber-700 border-amber-200",
  pending: "bg-gray-100 text-gray-600 border-gray-200",
};

export function PaymentList({
  payments,
  projectId,
  totalAmount,
}: {
  payments: PaymentRow[];
  projectId: string;
  totalAmount: number;
}) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paidAmount = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);

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
    if (!globalThis.confirm(`確定要刪除「${payment.name}」嗎？`)) return;

    setDeletingId(payment.id);
    setError(null);
    try {
      await deletePayment(payment.id, projectId);
      router.refresh();
    } catch {
      setError("刪除失敗，請重試");
    } finally {
      setDeletingId(null);
      setSwipedId(null);
    }
  };

  if (payments.length === 0) return null;

  return (
    <div className="bg-card rounded-xl shadow-sm p-4">
      {error && (
        <div className="pb-2 text-xs text-destructive">{error}</div>
      )}
      {payments.map((payment) => {
        const isUpdating = updatingId === payment.id;
        const isDeleting = deletingId === payment.id;
        const isSwiped = swipedId === payment.id;

        return (
          <div key={payment.id} className="relative overflow-hidden border-b border-sage-50 last:border-0">
            {/* Delete button */}
            <div className="absolute right-0 top-0 bottom-0 flex items-center">
              <button
                onClick={() => handleDelete(payment)}
                disabled={isDeleting}
                className="h-full px-4 bg-destructive text-white text-xs font-medium"
              >
                {isDeleting ? "..." : "刪除"}
              </button>
            </div>

            {/* Main content */}
            <div
              className={`relative bg-card flex items-center gap-3 py-2.5 transition-transform ${
                isSwiped ? "-translate-x-16" : "translate-x-0"
              }`}
              onClick={() => setSwipedId(isSwiped ? null : payment.id)}
            >
              {/* Status dropdown */}
              <select
                value={payment.status}
                onChange={(e) => {
                  e.stopPropagation();
                  handleStatusChange(payment, e.target.value as PaymentStatus);
                }}
                onClick={(e) => e.stopPropagation()}
                disabled={isUpdating}
                className={`shrink-0 text-[11px] font-semibold pl-2 pr-5 py-1 rounded-full border appearance-none cursor-pointer transition-all ${
                  isUpdating ? "opacity-50" : ""
                } ${paymentSelectStyle[payment.status]}`}
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 6px center",
                }}
              >
                {PAYMENT_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium">
                  {payment.name} {payment.percentage}%
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {payment.paid_date
                    ? `${payment.paid_date} 已付`
                    : payment.due_date
                      ? `預計 ${formatDate(payment.due_date)}`
                      : "待定"}
                </div>
              </div>

              <div
                className={`text-sm font-semibold shrink-0 ${
                  payment.status === "paid"
                    ? "text-sage-600"
                    : payment.status === "due"
                      ? "text-destructive"
                      : ""
                }`}
              >
                {formatCurrency(payment.amount)}
              </div>
            </div>
          </div>
        );
      })}

      <div className="flex justify-between text-[13px] mt-3 pt-3 border-t border-sage-200">
        <span>
          {"已收 "}
          <b className="text-sage-600">{formatCurrency(paidAmount)}</b>
        </span>
        <span>
          {"待收 "}
          <b className="text-destructive">{formatCurrency(totalAmount - paidAmount)}</b>
        </span>
      </div>
    </div>
  );
}
