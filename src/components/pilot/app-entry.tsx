"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchPilotSession } from "./api";
import { PilotBrand, PilotError, PilotLoading, PilotPage } from "./ui";

export function PilotAppEntry() {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void fetchPilotSession()
      .then((session) => {
        if (!active) return;
        const activeMembership = session.memberships.find(
          (membership) => membership.status === "active",
        );
        router.replace(activeMembership ? "/app/inbox" : "/app/onboarding");
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [attempt, router]);

  const retry = () => {
    setLoading(true);
    setError(false);
    setAttempt((current) => current + 1);
  };

  return (
    <PilotPage>
      <PilotBrand eyebrow="工作台" />
      {loading ? <PilotLoading label="正在確認工作空間" /> : null}
      {error ? (
        <PilotError
          title="無法確認登入狀態"
          description="連線可能暫時中斷。你的資料不會因此被修改，請重新確認一次。"
          actionLabel="再試一次"
          onRetry={retry}
        />
      ) : null}
    </PilotPage>
  );
}
