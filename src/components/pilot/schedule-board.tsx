"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { fetchPilotSession } from "./api";
import {
  PilotBrand,
  PilotCard,
  PilotError,
  PilotInlineNotice,
  PilotLoading,
  PilotPage,
} from "./ui";
import {
  fetchScheduleWindow,
  listWorkOrders,
  type WorkOrderListItem,
} from "./work-order-api";
import {
  formatTimeRange,
  MANAGER_ROLES,
  priorityLabel,
  statusLabel,
} from "./work-order-format";

type LoadStatus = "loading" | "ready" | "error" | "restricted";

interface BoardState {
  status: LoadStatus;
  organizationId: string | null;
  scheduled: WorkOrderListItem[];
  unscheduled: WorkOrderListItem[];
}

function windowRange(reference: Date): { from: string; to: string } {
  const from = new Date(reference);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 14);
  return { from: from.toISOString(), to: to.toISOString() };
}

function dayKey(value: string | null): string {
  if (!value) return "未定";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(value));
}

function groupByDay(items: WorkOrderListItem[]): [string, WorkOrderListItem[]][] {
  const groups = new Map<string, WorkOrderListItem[]>();
  for (const item of items) {
    const key = dayKey(item.scheduledStartAt);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return Array.from(groups.entries());
}

const defaultNow = () => new Date();

export function ScheduleBoard({ now = defaultNow }: Readonly<{ now?: () => Date }>) {
  const [state, setState] = useState<BoardState>({
    status: "loading",
    organizationId: null,
    scheduled: [],
    unscheduled: [],
  });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setState({ status: "loading", organizationId: null, scheduled: [], unscheduled: [] });
    try {
      const session = await fetchPilotSession();
      const membership = session.memberships.find((m) => m.status === "active");
      if (!membership) throw new Error("尚未建立工作空間");
      if (!MANAGER_ROLES.has(membership.role)) {
        setState({
          status: "restricted",
          organizationId: membership.organizationId,
          scheduled: [],
          unscheduled: [],
        });
        return;
      }

      const range = windowRange(now());
      const [scheduled, draftPage] = await Promise.all([
        fetchScheduleWindow(membership.organizationId, range.from, range.to),
        listWorkOrders(membership.organizationId, { status: "draft", pageSize: 50 }),
      ]);

      setState({
        status: "ready",
        organizationId: membership.organizationId,
        scheduled: scheduled
          .slice()
          .sort((a, b) =>
            (a.scheduledStartAt ?? "").localeCompare(b.scheduledStartAt ?? ""),
          ),
        unscheduled: draftPage.data,
      });
    } catch {
      setState((current) => ({ ...current, status: "error" }));
    }
  }, [now]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  if (state.status === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="排程板" />
        <PilotLoading label="正在載入排程" />
      </PilotPage>
    );
  }

  if (state.status === "restricted") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="排程板" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">你沒有排程權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            排程板僅開放給負責人、管理員與派工人員。師傅請到「我的工單」查看指派給你的工單。
          </p>
          <Link
            href="/app/my-work-orders"
            className="mt-4 inline-flex min-h-11 items-center text-sm font-bold text-orange"
          >
            前往我的工單
          </Link>
        </PilotCard>
      </PilotPage>
    );
  }

  if (state.status === "error") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="排程板" />
        <PilotError
          title="無法載入排程"
          description="連線可能暫時中斷。你的資料不會因此被修改，請重新確認一次。"
          actionLabel="重新載入"
          onRetry={() => setAttempt((current) => current + 1)}
        />
      </PilotPage>
    );
  }

  const dayGroups = groupByDay(state.scheduled);

  return (
    <PilotPage>
      <PilotBrand eyebrow="排程板" />
      <Link
        href="/app"
        className="mb-4 inline-flex min-h-10 items-center text-sm font-bold text-orange-deep"
      >
        ← 回工作台
      </Link>
      <div className="mb-4">
        <PilotInlineNotice tone="info">
          排程與派工通知尚未自動發送，將於下一階段開放。
        </PilotInlineNotice>
      </div>

      {state.unscheduled.length > 0 ? (
        <PilotCard className="mb-4">
          <h2 className="text-base font-black text-ink">待排程工單</h2>
          <p className="mt-1 text-xs text-ink-3">點選工單即可排程並指派師傅。</p>
          <ul className="mt-3 space-y-2" aria-label="待排程工單">
            {state.unscheduled.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/app/work-orders/${item.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-warm-border-strong bg-bg-warm px-3 py-2.5 transition hover:border-orange/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-ink-2">
                      {item.title}
                    </span>
                    <span className="font-mono text-[11px] text-ink-3">{item.workOrderNo}</span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-orange">排程 →</span>
                </Link>
              </li>
            ))}
          </ul>
        </PilotCard>
      ) : null}

      {dayGroups.length === 0 ? (
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">這兩週還沒有排程工單</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            把待排程工單安排時間與師傅後，就會出現在這裡。
          </p>
        </PilotCard>
      ) : (
        <div className="space-y-5">
          {dayGroups.map(([day, items]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-black text-ink-2">{day}</h2>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/app/work-orders/${item.id}`}
                      className="block rounded-[18px] border border-warm-border bg-white p-3.5 shadow-sm transition hover:border-orange/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-ink">{item.title}</p>
                          <p className="mt-0.5 text-xs text-ink-2">
                            {formatTimeRange(item.scheduledStartAt, item.scheduledEndAt)}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-orange-soft px-2.5 py-1 text-[11px] font-bold text-orange-deep">
                          {statusLabel(item.status)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-3">
                        <span>{item.assigneeCount} 位師傅</span>
                        {item.priority !== "normal" ? (
                          <span className="font-bold text-orange-deep">
                            {priorityLabel(item.priority)}優先
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PilotPage>
  );
}
