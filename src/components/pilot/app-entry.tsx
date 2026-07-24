"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchPilotSession, type PilotMembership } from "./api";
import { PilotBrand, PilotError, PilotLoading, PilotPage } from "./ui";

const MANAGER_ROLES = new Set<PilotMembership["role"]>(["owner", "admin", "dispatcher"]);

interface HubCard {
  href: string;
  title: string;
  description: string;
}

const HUB_CARDS: readonly HubCard[] = [
  {
    href: "/app/inbox",
    title: "接案匣",
    description: "查看並整理客戶送出的報修需求。",
  },
  {
    href: "/app/schedule",
    title: "排程",
    description: "為工單安排時間並指派師傅。",
  },
  {
    href: "/app/settings/team",
    title: "成員",
    description: "新增技師、管理團隊角色與狀態。",
  },
  {
    href: "/app/settings",
    title: "設定",
    description: "維護店家資訊與公開報修連結。",
  },
];

type EntryState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "hub"; membership: PilotMembership };

export function PilotAppEntry() {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<EntryState>({ kind: "loading" });

  useEffect(() => {
    let active = true;

    void fetchPilotSession()
      .then((session) => {
        if (!active) return;
        const membership = session.memberships.find(
          (candidate) => candidate.status === "active",
        );
        if (!membership) {
          router.replace("/app/onboarding");
          return;
        }
        if (!MANAGER_ROLES.has(membership.role)) {
          router.replace("/app/today");
          return;
        }
        setState({ kind: "hub", membership });
      })
      .catch(() => {
        if (!active) return;
        setState({ kind: "error" });
      });

    return () => {
      active = false;
    };
  }, [attempt, router]);

  const retry = () => {
    setState({ kind: "loading" });
    setAttempt((current) => current + 1);
  };

  return (
    <PilotPage>
      <PilotBrand eyebrow="工作台" />
      {state.kind === "loading" ? <PilotLoading label="正在確認工作空間" /> : null}
      {state.kind === "error" ? (
        <PilotError
          title="無法確認登入狀態"
          description="連線可能暫時中斷。你的資料不會因此被修改，請重新確認一次。"
          actionLabel="再試一次"
          onRetry={retry}
        />
      ) : null}
      {state.kind === "hub" ? (
        <div>
          <header className="mb-5">
            <h1 className="text-[28px] font-black tracking-[-0.04em] text-ink">工作台</h1>
            <p className="mt-1 text-sm text-ink-3">
              {state.membership.displayName}，選擇要處理的區塊。
            </p>
          </header>
          <div className="grid grid-cols-1 gap-3">
            {HUB_CARDS.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="flex items-center justify-between gap-4 rounded-[22px] border border-warm-border bg-white p-5 shadow-[0_14px_36px_rgba(74,45,20,0.07)] transition hover:border-orange/40"
              >
                <span className="min-w-0">
                  <span className="block text-lg font-black text-ink">{card.title}</span>
                  <span className="mt-1 block text-sm leading-6 text-ink-3">
                    {card.description}
                  </span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-xl font-black text-orange">
                  →
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </PilotPage>
  );
}
