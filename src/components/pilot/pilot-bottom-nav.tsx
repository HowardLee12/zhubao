"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { PilotMembership } from "./api";

interface NavTab {
  href: string;
  label: string;
  /**
   * When true the tab is active only on an exact path match. Hub-style roots
   * (e.g. `/app`) use this so they do not light up on every nested route; the
   * default is prefix matching so `/app/inbox/123` still activates 接案匣.
   */
  exact?: boolean;
}

// Six manager tabs fit a 390px bottom nav at the 11px label size. M8 adds 收款 and
// 回訪; 成員 leaves the persistent nav (still reachable from 設定) so the M8 surfaces
// have a home without crowding the bar. 工作台 doubles as the KPI dashboard hub — a
// technician never sees any of these (their tab set is separate and amount-free).
const MANAGER_TABS: readonly NavTab[] = [
  { href: "/app", label: "工作台", exact: true },
  { href: "/app/inbox", label: "接案匣" },
  { href: "/app/schedule", label: "排程" },
  { href: "/app/payments", label: "收款" },
  { href: "/app/follow-ups", label: "回訪" },
  { href: "/app/settings", label: "設定", exact: true },
];

const TECHNICIAN_TABS: readonly NavTab[] = [
  { href: "/app/today", label: "今日" },
  { href: "/app/my-work-orders", label: "我的工單" },
];

const MANAGER_ROLES = new Set<PilotMembership["role"]>(["owner", "admin", "dispatcher"]);

export function tabsForRole(role: PilotMembership["role"]): readonly NavTab[] {
  return MANAGER_ROLES.has(role) ? MANAGER_TABS : TECHNICIAN_TABS;
}

function isTabActive(tab: NavTab, pathname: string): boolean {
  if (tab.exact) return pathname === tab.href;
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

export function PilotBottomNav({ role }: Readonly<{ role: PilotMembership["role"] }>) {
  const pathname = usePathname();
  const tabs = tabsForRole(role);

  return (
    <nav
      aria-label="主導覽"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-warm-border bg-white/95 backdrop-blur"
    >
      <ul className="mx-auto flex w-full max-w-[430px] items-stretch">
        {tabs.map((tab) => {
          const active = isTabActive(tab, pathname);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-bold transition ${
                  active ? "text-orange-deep" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1 w-6 rounded-full transition ${
                    active ? "bg-orange" : "bg-transparent"
                  }`}
                />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
