"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { fetchPilotSession, type PilotMembership } from "@/components/pilot/api";
import { PilotBottomNav } from "@/components/pilot/pilot-bottom-nav";

// Routes that are pre-membership or full-screen flows where the persistent nav
// would be a dead weight (there is nowhere to navigate laterally yet).
const NAVLESS_PREFIXES = ["/app/onboarding"] as const;

function isNavlessPath(pathname: string): boolean {
  return NAVLESS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function PilotStaffLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const [role, setRole] = useState<PilotMembership["role"] | null>(null);

  useEffect(() => {
    let active = true;

    void fetchPilotSession()
      .then((session) => {
        if (!active) return;
        const membership = session.memberships.find(
          (candidate) => candidate.status === "active",
        );
        setRole(membership ? membership.role : null);
      })
      .catch(() => {
        if (active) setRole(null);
      });

    return () => {
      active = false;
    };
  }, [pathname]);

  const showNav = role !== null && !isNavlessPath(pathname);

  return (
    <>
      <div className={showNav ? "pb-20" : undefined}>{children}</div>
      {showNav ? <PilotBottomNav role={role} /> : null}
    </>
  );
}
