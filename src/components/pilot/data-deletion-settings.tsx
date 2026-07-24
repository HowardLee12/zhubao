"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchPilotSession, type PilotMembership } from "./api";
import {
  finalizeDataDeletion,
  requestDataDeletion,
  type DataDeletionRequested,
} from "./operations-api";
import {
  Field,
  PilotBrand,
  PilotButton,
  PilotCard,
  PilotError,
  PilotInlineNotice,
  PilotInput,
  PilotLoading,
  PilotPage,
} from "./ui";

type LoadState = "loading" | "ready" | "error" | "restricted";
type Phase = "idle" | "requested" | "finalized";

// Owner-only pilot data deletion. The owner re-authenticates by re-entering their
// login password; the client sends it to the request/finalize routes which hash it
// before it reaches the RPC (the raw token never touches the database). Finalize
// anonymizes only THIS org's customer name/phone/email/address while keeping the
// transaction ids needed for audit — it is org-scoped and confirm-once.
export function DataDeletionSettings() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [reauthToken, setReauthToken] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [request, setRequest] = useState<DataDeletionRequested | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anonymized, setAnonymized] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPilotSession()
      .then((sessionData) => {
        const membership: PilotMembership | undefined = sessionData.memberships.find(
          (m) => m.status === "active",
        );
        if (!membership) throw new Error("尚未建立工作空間");
        if (membership.role !== "owner") {
          if (active) setLoadState("restricted");
          return;
        }
        if (!active) return;
        setOrganizationId(membership.organizationId);
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const startDeletion = async () => {
    if (!organizationId) return;
    const token = reauthToken.trim();
    if (token.length < 8) {
      setError("請再次輸入你的登入密碼以確認身分（至少 8 個字元）。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await requestDataDeletion(organizationId, token);
      setRequest(result);
      setPhase("requested");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "無法開始刪除流程，請稍後再試。");
    } finally {
      setBusy(false);
    }
  };

  const confirmDeletion = async () => {
    if (!organizationId || !request) return;
    setBusy(true);
    setError(null);
    try {
      const result = await finalizeDataDeletion(
        organizationId,
        request.deletionRequestId,
        reauthToken.trim(),
      );
      setAnonymized(result.anonymizedCustomers ?? null);
      setPhase("finalized");
      setReauthToken("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "無法完成刪除，請稍後再試。");
    } finally {
      setBusy(false);
    }
  };

  if (loadState === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="資料刪除" />
        <PilotLoading label="正在載入" />
      </PilotPage>
    );
  }

  if (loadState === "restricted") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="資料刪除" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">你沒有檢視權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            資料刪除僅開放給負責人本人操作。
          </p>
        </PilotCard>
      </PilotPage>
    );
  }

  if (loadState === "error") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="資料刪除" />
        <PilotError
          title="頁面暫時讀不到"
          description="請確認網路後重新載入。"
          actionLabel="重新載入"
          onRetry={() => setLoadState("loading")}
        />
      </PilotPage>
    );
  }

  return (
    <PilotPage>
      <PilotBrand eyebrow="資料刪除" />
      <Link
        href="/app/settings"
        className="mb-4 inline-flex min-h-10 items-center text-sm font-bold text-orange-deep"
      >
        ← 回店家設定
      </Link>
      <header className="mb-5">
        <h1 className="text-[28px] font-black tracking-[-0.04em] text-ink">刪除店家資料</h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          這會匿名化本店家客戶的姓名、電話、Email 與地址，且無法復原。為了稽核，交易與工單的識別碼會保留。
        </p>
      </header>

      {error ? (
        <div className="mb-4">
          <PilotInlineNotice>{error}</PilotInlineNotice>
        </div>
      ) : null}

      {phase === "finalized" ? (
        <PilotCard className="py-8 text-center">
          <PilotInlineNotice tone="success">
            已完成匿名化{anonymized !== null ? `，共處理 ${anonymized} 位客戶。` : "。"}
          </PilotInlineNotice>
          <p className="mt-4 text-sm leading-6 text-ink-3">
            客戶個資已無法復原；交易與稽核紀錄的識別碼保留。
          </p>
        </PilotCard>
      ) : (
        <PilotCard className="border-[var(--warm-red)]/20">
          <p className="text-xs font-bold text-[var(--warm-red)]">危險操作 · 無法復原</p>
          <Field hint="輸入你登入 Renoly 用的密碼，用來確認是本人操作。密碼不會被儲存。">
            <label
              htmlFor="reauth-token"
              className="mb-1.5 mt-3 block text-sm font-bold text-ink-2"
            >
              再次輸入登入密碼
            </label>
            <PilotInput
              id="reauth-token"
              type="password"
              autoComplete="current-password"
              value={reauthToken}
              onChange={(event) => {
                setReauthToken(event.target.value);
                setError(null);
              }}
            />
          </Field>

          {phase === "idle" ? (
            <PilotButton
              type="button"
              variant="danger"
              className="mt-5 w-full"
              disabled={busy}
              onClick={() => void startDeletion()}
            >
              {busy ? "處理中…" : "開始刪除流程"}
            </PilotButton>
          ) : (
            <div className="mt-5 space-y-3">
              <div
                role="alert"
                className="rounded-xl border border-[var(--warm-red)]/20 bg-[var(--warm-red-soft)] p-3 text-sm font-bold text-[var(--warm-red)]"
              >
                最後確認：這會永久匿名化本店家的客戶個資，且無法復原。
              </div>
              <PilotButton
                type="button"
                variant="danger"
                className="w-full"
                disabled={busy}
                onClick={() => void confirmDeletion()}
              >
                {busy ? "處理中…" : "確認永久匿名化"}
              </PilotButton>
            </div>
          )}
        </PilotCard>
      )}
    </PilotPage>
  );
}
