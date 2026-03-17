"use client";

import { useState } from "react";
import { updatePaymentStatus, deletePayment } from "@/lib/actions";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDate } from "@/lib/format";
import Link from "next/link";
import type { PaymentRow } from "@/lib/database.types";

type PaymentStatus = PaymentRow["status"];

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

interface PaymentWithProject extends PaymentRow {
  projectId: string;
  projectName: string;
}

function formatMonthKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
}

const SELECT_ARROW_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`;

function PaymentItem({
  payment,
  showProject,
  onStatusChange,
  onDelete,
  isUpdating,
}: {
  payment: PaymentWithProject;
  showProject: boolean;
  onStatusChange: (payment: PaymentWithProject, status: PaymentStatus) => void;
  onDelete: (payment: PaymentWithProject) => void;
  isUpdating: boolean;
}) {
  const [swiped, setSwiped] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!globalThis.confirm(`確定要刪除「${payment.name}」嗎？`)) return;
    setDeleting(true);
    onDelete(payment);
  };

  return (
    <div className="relative overflow-hidden border-b border-sage-50 last:border-0">
      <div className="absolute right-0 top-0 bottom-0 flex items-center">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="h-full px-4 bg-destructive text-white text-xs font-medium"
        >
          {deleting ? "..." : "刪除"}
        </button>
      </div>

      <div
        className={`relative bg-card flex items-center gap-3 py-2.5 transition-transform ${
          swiped ? "-translate-x-16" : "translate-x-0"
        }`}
        onClick={() => setSwiped((prev) => !prev)}
      >
        <select
          value={payment.status}
          onChange={(e) => {
            e.stopPropagation();
            onStatusChange(payment, e.target.value as PaymentStatus);
          }}
          onClick={(e) => e.stopPropagation()}
          disabled={isUpdating}
          className={`shrink-0 text-[11px] font-semibold pl-2 pr-5 py-1 rounded-full border appearance-none cursor-pointer transition-all ${
            isUpdating ? "opacity-50" : ""
          } ${paymentSelectStyle[payment.status]}`}
          style={{
            backgroundImage: SELECT_ARROW_BG,
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
          <div className="text-[13px] font-medium truncate">
            {payment.name} {payment.percentage}%
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {showProject && (
              <Link
                href={`/projects/${payment.projectId}`}
                onClick={(e) => e.stopPropagation()}
                className="text-primary hover:underline underline-offset-2"
              >
                {payment.projectName}
              </Link>
            )}
            {showProject && " · "}
            {payment.paid_date
              ? `${formatDate(payment.paid_date)} 已收`
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
}

export function PaymentsPageList({
  payments,
}: {
  payments: PaymentWithProject[];
}) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  const handleStatusChange = async (payment: PaymentWithProject, newStatus: PaymentStatus) => {
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

  const handleDelete = async (payment: PaymentWithProject) => {
    setError(null);
    try {
      await deletePayment(payment.id, payment.projectId);
      router.refresh();
    } catch {
      setError("刪除失敗，請重試");
    }
  };

  const toggleMonth = (monthKey: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  };

  // Split into unpaid vs paid
  const unpaidPayments = payments.filter((p) => p.status !== "paid");
  const paidPayments = payments.filter((p) => p.status === "paid");

  // Sort unpaid: due first, then upcoming, then pending
  const statusOrder: Record<PaymentStatus, number> = {
    due: 0,
    upcoming: 1,
    pending: 2,
    paid: 3,
  };
  const sortedUnpaid = [...unpaidPayments].sort((a, b) => {
    const orderDiff = statusOrder[a.status] - statusOrder[b.status];
    if (orderDiff !== 0) return orderDiff;
    const aDate = a.due_date ?? "9999";
    const bDate = b.due_date ?? "9999";
    return aDate.localeCompare(bDate);
  });

  // Group unpaid by status
  const unpaidGroups = ([
    { label: "已到期", status: "due" as PaymentStatus, items: sortedUnpaid.filter((p) => p.status === "due") },
    { label: "即將到期", status: "upcoming" as PaymentStatus, items: sortedUnpaid.filter((p) => p.status === "upcoming") },
    { label: "待收", status: "pending" as PaymentStatus, items: sortedUnpaid.filter((p) => p.status === "pending") },
  ]).filter((g) => g.items.length > 0);

  // Group paid by month (paid_date), sorted descending
  const paidByMonth = paidPayments.reduce<Record<string, PaymentWithProject[]>>((acc, p) => {
    const key = p.paid_date ? formatMonthKey(p.paid_date) : "unknown";
    return { ...acc, [key]: [...(acc[key] ?? []), p] };
  }, {});

  // Sort items within each month: group by project, then by paid_date
  const sortedPaidByMonth = Object.fromEntries(
    Object.entries(paidByMonth).map(([key, items]) => [
      key,
      [...items].sort((a, b) => {
        const projectCmp = a.projectName.localeCompare(b.projectName);
        if (projectCmp !== 0) return projectCmp;
        return (a.paid_date ?? "").localeCompare(b.paid_date ?? "");
      }),
    ])
  );
  const sortedMonthKeys = Object.keys(sortedPaidByMonth).sort((a, b) => b.localeCompare(a));

  if (payments.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <div className="text-sm">還沒有收款紀錄</div>
      </div>
    );
  }

  return (
    <div className="px-4 space-y-4 pb-4">
      {error && (
        <div className="text-xs text-destructive text-center">{error}</div>
      )}

      {/* Unpaid section */}
      {unpaidGroups.length > 0 && (
        <div>
          <div className="text-[13px] font-semibold text-sage-800 mb-2">待收款</div>
          <div className="bg-card rounded-xl shadow-sm overflow-hidden">
            {unpaidGroups.map((group) => (
              <div key={group.status}>
                <div className="px-4 py-1.5 bg-sage-50 border-b border-sage-100">
                  <span className={`text-[11px] font-semibold ${
                    group.status === "due"
                      ? "text-red-600"
                      : group.status === "upcoming"
                        ? "text-amber-600"
                        : "text-gray-500"
                  }`}>
                    {group.label}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {formatCurrency(group.items.reduce((s, p) => s + p.amount, 0))}
                    </span>
                  </span>
                </div>
                <div className="px-4">
                  {group.items.map((payment) => (
                    <PaymentItem
                      key={payment.id}
                      payment={payment}
                      showProject={true}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                      isUpdating={updatingId === payment.id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paid history section */}
      {sortedMonthKeys.length > 0 && (
        <div>
          <div className="text-[13px] font-semibold text-sage-800 mb-2">已收紀錄</div>
          <div className="space-y-2">
            {sortedMonthKeys.map((monthKey) => {
              const items = sortedPaidByMonth[monthKey];
              const monthTotal = items.reduce((s, p) => s + p.amount, 0);
              const isCollapsed = collapsedMonths.has(monthKey);

              return (
                <div key={monthKey} className="bg-card rounded-xl shadow-sm overflow-hidden">
                  <button
                    onClick={() => toggleMonth(monthKey)}
                    className="w-full px-4 py-2.5 flex justify-between items-center hover:bg-sage-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg
                        className={`w-3 h-3 text-muted-foreground transition-transform ${
                          isCollapsed ? "" : "rotate-90"
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="text-[13px] font-semibold text-sage-700">
                        {monthKey === "unknown" ? "日期未記錄" : formatMonthLabel(monthKey)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {items.length} 筆
                      </span>
                    </div>
                    <span className="text-sm font-bold text-sage-600">
                      {formatCurrency(monthTotal)}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="px-4 border-t border-sage-100">
                      {items.map((payment) => (
                        <PaymentItem
                          key={payment.id}
                          payment={payment}
                          showProject={true}
                          onStatusChange={handleStatusChange}
                          onDelete={handleDelete}
                          isUpdating={updatingId === payment.id}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
