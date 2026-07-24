"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { fetchPilotSession } from "./api";
import {
  PilotBrand,
  PilotButton,
  PilotCard,
  PilotError,
  PilotLoading,
  PilotPage,
} from "./ui";
import { listWorkOrders, type WorkOrderListItem } from "./work-order-api";
import { formatTimeRange, statusLabel } from "./work-order-format";

type LoadStatus = "loading" | "ready" | "error";

interface TodayState {
  status: LoadStatus;
  next: WorkOrderListItem | null;
  remaining: WorkOrderListItem[];
}

const ACTIVE_STATUSES = ["en_route", "on_site", "paused", "dispatched", "scheduled"];

export function TechnicianToday() {
  const [state, setState] = useState<TodayState>({
    status: "loading",
    next: null,
    remaining: [],
  });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setState({ status: "loading", next: null, remaining: [] });
    try {
      const session = await fetchPilotSession();
      const membership = session.memberships.find((m) => m.status === "active");
      if (!membership) throw new Error("尚未建立工作空間");

      const pages = await Promise.all(
        ACTIVE_STATUSES.map((status) =>
          listWorkOrders(membership.organizationId, {
            status,
            assigneeId: membership.id,
            pageSize: 50,
          }),
        ),
      );
      const items = pages
        .flatMap((page) => page.data)
        .sort((a, b) =>
          (a.scheduledStartAt ?? a.createdAt).localeCompare(
            b.scheduledStartAt ?? b.createdAt,
          ),
        );

      setState({ status: "ready", next: items[0] ?? null, remaining: items.slice(1) });
    } catch {
      setState({ status: "error", next: null, remaining: [] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  if (state.status === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="今日工作" />
        <PilotLoading label="正在載入今日工作" />
      </PilotPage>
    );
  }

  if (state.status === "error") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="今日工作" />
        <PilotError
          title="無法載入今日工作"
          description="連線可能暫時中斷。你的資料不會因此被修改，請重新確認一次。"
          actionLabel="重新載入"
          onRetry={() => setAttempt((current) => current + 1)}
        />
      </PilotPage>
    );
  }

  return (
    <PilotPage>
      <PilotBrand eyebrow="今日工作" />
      {state.next === null ? (
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">今天沒有指派給你的工單</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            派工後，指派給你的工單會出現在這裡。
          </p>
          <Link
            href="/app/my-work-orders"
            className="mt-4 inline-flex min-h-11 items-center text-sm font-bold text-orange"
          >
            查看全部工單
          </Link>
        </PilotCard>
      ) : (
        <>
          <PilotCard>
            <p className="text-xs font-bold uppercase tracking-wide text-orange-deep">下一張工單</p>
            <h1 className="mt-1 text-xl font-black tracking-tight text-ink">{state.next.title}</h1>
            <p className="mt-0.5 font-mono text-xs text-ink-3">{state.next.workOrderNo}</p>
            <p className="mt-3 text-sm text-ink-2">
              {formatTimeRange(state.next.scheduledStartAt, state.next.scheduledEndAt)}
            </p>
            <span className="mt-3 inline-flex rounded-full bg-orange-soft px-3 py-1 text-xs font-bold text-orange-deep">
              {statusLabel(state.next.status)}
            </span>
            <Link href={`/app/my-work-orders/${state.next.id}`} className="mt-4 block">
              <PilotButton className="w-full">開始這張工單</PilotButton>
            </Link>
          </PilotCard>

          {state.remaining.length > 0 ? (
            <div className="mt-5">
              <h2 className="mb-2 text-sm font-black text-ink-2">後續工單</h2>
              <ul className="space-y-2">
                {state.remaining.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/app/my-work-orders/${item.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-warm-border bg-white px-3 py-2.5 transition hover:border-orange/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-ink-2">
                          {item.title}
                        </span>
                        <span className="text-[11px] text-ink-3">
                          {formatTimeRange(item.scheduledStartAt, item.scheduledEndAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-bold text-orange-deep">
                        {statusLabel(item.status)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </PilotPage>
  );
}
