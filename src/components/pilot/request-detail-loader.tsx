"use client";

import { useEffect, useState } from "react";

import { fetchPilotSession } from "./api";
import { PilotRequestDetail } from "./request-detail";
import { PilotBrand, PilotError, PilotLoading, PilotPage } from "./ui";

type LoaderState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; organizationId: string };

/**
 * Resolves the active organization for the signed-in staff member, then hands
 * off to {@link PilotRequestDetail}, which owns the role gate and the full
 * triage/convert workflow. Splitting resolution out keeps the workflow
 * component pure (organizationId + requestId in) and independently testable.
 */
export function PilotRequestDetailLoader({ requestId }: Readonly<{ requestId: string }>) {
  const [state, setState] = useState<LoaderState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    void fetchPilotSession()
      .then((session) => {
        if (!active) return;
        const membership = session.memberships.find(
          (candidate) => candidate.status === "active",
        );
        if (!membership) {
          setState({ status: "error" });
          return;
        }
        setState({ status: "ready", organizationId: membership.organizationId });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.status === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="接案整理" />
        <PilotLoading label="正在載入案件內容" />
      </PilotPage>
    );
  }

  if (state.status === "error") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="接案整理" />
        <PilotError
          title="無法載入工作空間"
          description="連線可能暫時中斷。你的資料不會因此被修改，請重新確認一次。"
          actionLabel="重新載入"
          onRetry={() => setAttempt((current) => current + 1)}
        />
      </PilotPage>
    );
  }

  return <PilotRequestDetail organizationId={state.organizationId} requestId={requestId} />;
}
