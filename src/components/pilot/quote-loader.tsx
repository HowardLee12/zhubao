"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { QuoteWorkspace } from "@/schemas/quote";

import { fetchPilotSession, PilotApiError } from "./api";
import { fetchQuoteWorkspace, fetchQuoteWorkspaceForRequest } from "./quote-api";
import { PilotQuoteEditor } from "./quote-editor";
import { fetchServiceRequestDetail, type ServiceRequestDetail } from "./triage-api";
import { PilotBrand, PilotCard, PilotError, PilotLoading, PilotPage } from "./ui";

type QuoteRole = "owner" | "admin" | "dispatcher";

type LoaderState =
  | { status: "loading" }
  | { status: "restricted" }
  | { status: "invalid"; message: string; requestId: string | null }
  | { status: "error" }
  | {
      status: "ready";
      organizationId: string;
      role: QuoteRole;
      request: ServiceRequestDetail | null;
      workspace: QuoteWorkspace | null;
    };

const QUOTE_ROLES = new Set<QuoteRole>(["owner", "admin", "dispatcher"]);
const QUOTABLE_REQUEST_STATUSES = new Set(["triaged", "quoting"]);

export function PilotQuoteLoader({
  quoteId,
  requestId,
}: Readonly<{ quoteId?: string; requestId?: string }>) {
  const [state, setState] = useState<LoaderState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      setState({ status: "loading" });
      try {
        const session = await fetchPilotSession();
        const membership = session.memberships.find(
          (candidate) =>
            candidate.status === "active" &&
            QUOTE_ROLES.has(candidate.role as QuoteRole),
        );
        if (!membership) {
          if (active) setState({ status: "restricted" });
          return;
        }

        if (quoteId) {
          const workspace = await fetchQuoteWorkspace(membership.organizationId, quoteId);
          if (active) {
            setState({
              status: "ready",
              organizationId: membership.organizationId,
              role: membership.role as QuoteRole,
              request: null,
              workspace,
            });
          }
          return;
        }

        if (!requestId) {
          if (active) {
            setState({ status: "invalid", message: "缺少進件或報價編號。", requestId: null });
          }
          return;
        }

        const [request, workspace] = await Promise.all([
          fetchServiceRequestDetail(membership.organizationId, requestId),
          fetchQuoteWorkspaceForRequest(membership.organizationId, requestId),
        ]);

        if (!workspace && (!request.customerId || !request.locationId)) {
          if (active) {
            setState({
              status: "invalid",
              message: "建立報價前，請先在進件頁綁定客戶與服務地點並完成分流。",
              requestId,
            });
          }
          return;
        }

        if (!workspace && !QUOTABLE_REQUEST_STATUSES.has(request.status)) {
          if (active) {
            setState({
              status: "invalid",
              message: "這筆進件目前不能建立新報價；請回到進件確認狀態。",
              requestId,
            });
          }
          return;
        }

        if (active) {
          setState({
            status: "ready",
            organizationId: membership.organizationId,
            role: membership.role as QuoteRole,
            request,
            workspace,
          });
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof PilotApiError && error.status === 403) {
          setState({ status: "restricted" });
          return;
        }
        setState({ status: "error" });
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [attempt, quoteId, requestId]);

  if (state.status === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="報價工作區" />
        <PilotLoading label="正在載入報價" />
      </PilotPage>
    );
  }

  if (state.status === "restricted") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="報價工作區" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-xl font-black text-ink">沒有管理報價的權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            只有 owner、admin 或 dispatcher 可以檢視報價；送出仍限 owner／admin。
          </p>
          <Link
            href="/app/inbox"
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-warm-border-strong bg-white px-4 text-sm font-bold text-ink"
          >
            回接案匣
          </Link>
        </PilotCard>
      </PilotPage>
    );
  }

  if (state.status === "invalid") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="報價工作區" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-xl font-black text-ink">還不能建立報價</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">{state.message}</p>
          <Link
            href={state.requestId ? `/app/inbox/${state.requestId}` : "/app/inbox"}
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-orange px-4 text-sm font-bold text-white"
          >
            回到進件確認
          </Link>
        </PilotCard>
      </PilotPage>
    );
  }

  if (state.status === "error") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="報價工作區" />
        <PilotError
          title="報價暫時讀不到"
          description="資料仍安全保存在系統中。請確認網路後重新載入。"
          actionLabel="重新載入"
          onRetry={() => setAttempt((current) => current + 1)}
        />
      </PilotPage>
    );
  }

  return (
    <PilotQuoteEditor
      organizationId={state.organizationId}
      role={state.role}
      request={state.request}
      initialWorkspace={state.workspace}
    />
  );
}
