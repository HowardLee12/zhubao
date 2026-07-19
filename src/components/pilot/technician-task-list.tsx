"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { fetchPilotSession, type PilotMembership } from "./api";
import {
  PilotBrand,
  PilotCard,
  PilotError,
  PilotLoading,
  PilotPage,
} from "./ui";
import { listWorkOrders, type WorkOrderListItem } from "./work-order-api";
import {
  formatTimeRange,
  priorityLabel,
  statusLabel,
} from "./work-order-format";

type TaskTab = "upcoming" | "active" | "completed";

interface TabDefinition {
  id: TaskTab;
  label: string;
  statuses: string[];
  emptyHeading: string;
  emptyBody: string;
}

// Only-own tabs. list_work_orders filters to the technician's own active
// assignments server-side; the assigneeId filter narrows to this member so a
// manager viewing their own list also sees only what they are assigned to.
const TABS: readonly TabDefinition[] = [
  {
    id: "upcoming",
    label: "待執行",
    statuses: ["scheduled", "dispatched"],
    emptyHeading: "目前沒有待執行的工單",
    emptyBody: "派工後，指派給你的工單會出現在這裡。",
  },
  {
    id: "active",
    label: "進行中",
    statuses: ["en_route", "on_site", "paused"],
    emptyHeading: "目前沒有進行中的工單",
    emptyBody: "出發或抵達後，工單會移到這一區方便你回報。",
  },
  {
    id: "completed",
    label: "已完成",
    statuses: ["completed"],
    emptyHeading: "還沒有已完成的工單",
    emptyBody: "完工後的工單會保留在這裡供你查閱。",
  },
];

type LoadStatus = "loading" | "ready" | "error";

interface TaskListState {
  status: LoadStatus;
  tab: TaskTab;
  organizationId: string | null;
  membershipId: string | null;
  items: WorkOrderListItem[];
}

function tabFor(id: TaskTab): TabDefinition {
  return TABS.find((tab) => tab.id === id) ?? TABS[0];
}

function activeMembership(memberships: PilotMembership[]): PilotMembership | undefined {
  return memberships.find((membership) => membership.status === "active");
}

export function TechnicianTaskList() {
  const [state, setState] = useState<TaskListState>({
    status: "loading",
    tab: "active",
    organizationId: null,
    membershipId: null,
    items: [],
  });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(
    async (tab: TaskTab, known: { organizationId: string; membershipId: string } | null) => {
      setState((current) => ({ ...current, status: "loading", tab, items: [] }));
      try {
        let context = known;
        if (!context) {
          const session = await fetchPilotSession();
          const membership = activeMembership(session.memberships);
          if (!membership) throw new Error("尚未建立工作空間");
          context = {
            organizationId: membership.organizationId,
            membershipId: membership.id,
          };
        }

        const definition = tabFor(tab);
        const pages = await Promise.all(
          definition.statuses.map((status) =>
            listWorkOrders(context.organizationId, {
              status,
              assigneeId: context.membershipId,
              pageSize: 50,
            }),
          ),
        );
        const merged = pages
          .flatMap((page) => page.data)
          .sort((a, b) =>
            (a.scheduledStartAt ?? a.createdAt).localeCompare(
              b.scheduledStartAt ?? b.createdAt,
            ),
          );

        setState({
          status: "ready",
          tab,
          organizationId: context.organizationId,
          membershipId: context.membershipId,
          items: merged,
        });
      } catch {
        setState((current) => ({ ...current, status: "error", tab }));
      }
    },
    [],
  );

  useEffect(() => {
    void load("active", null);
  }, [load, attempt]);

  const switchTab = (tab: TaskTab) => {
    if (state.organizationId && state.membershipId) {
      void load(tab, {
        organizationId: state.organizationId,
        membershipId: state.membershipId,
      });
    } else {
      void load(tab, null);
    }
  };

  const definition = tabFor(state.tab);

  return (
    <PilotPage>
      <PilotBrand eyebrow="我的工單" />
      <div
        role="tablist"
        aria-label="工單狀態"
        className="mb-4 flex gap-1 rounded-2xl bg-bg-warm p-1"
      >
        {TABS.map((tab) => {
          const isActive = tab.id === state.tab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => switchTab(tab.id)}
              className={`min-h-11 flex-1 rounded-xl px-2 text-sm font-bold transition ${
                isActive ? "bg-white text-orange shadow-sm" : "text-ink-3"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {state.status === "loading" ? (
        <PilotLoading label="正在載入你的工單" />
      ) : null}

      {state.status === "error" ? (
        <PilotError
          title="無法載入工單"
          description="連線可能暫時中斷。你的資料不會因此被修改，請重新確認一次。"
          actionLabel="重新載入"
          onRetry={() => setAttempt((current) => current + 1)}
        />
      ) : null}

      {state.status === "ready" && state.items.length === 0 ? (
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">{definition.emptyHeading}</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">{definition.emptyBody}</p>
        </PilotCard>
      ) : null}

      {state.status === "ready" && state.items.length > 0 ? (
        <ul className="space-y-3">
          {state.items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/app/my-work-orders/${item.id}`}
                className="block rounded-[20px] border border-warm-border bg-white p-4 shadow-sm transition hover:border-orange/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-black text-ink">{item.title}</p>
                    <p className="mt-0.5 font-mono text-xs text-ink-3">{item.workOrderNo}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-orange-soft px-2.5 py-1 text-[11px] font-bold text-orange-deep">
                    {statusLabel(item.status)}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-2">
                  <span>{formatTimeRange(item.scheduledStartAt, item.scheduledEndAt)}</span>
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
      ) : null}
    </PilotPage>
  );
}
