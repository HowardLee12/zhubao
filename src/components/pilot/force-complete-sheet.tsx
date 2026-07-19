"use client";

import { useState } from "react";

import { Field, PilotButton, PilotCard, PilotInlineNotice, PilotTextarea } from "./ui";
import type { ForceCompleteInput } from "./work-order-api";

/**
 * Owner/admin exception completion. This is explicitly NOT a customer sign-off:
 * the copy says so, the server records a distinct work_order.force_completed
 * audit event and never sets customerSignedAt. Reason and summary are both
 * mandatory; the DB re-enforces the owner gate.
 */
export function ForceCompleteSheet({
  onCancel,
  onForceComplete,
}: Readonly<{
  onCancel: () => void;
  onForceComplete: (input: ForceCompleteInput) => Promise<void>;
}>) {
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (reason.trim() === "") {
      setError("請填寫例外完工原因。");
      return;
    }
    if (summary.trim() === "") {
      setError("請填寫完工摘要。");
      return;
    }
    setBusy(true);
    try {
      await onForceComplete({ reason: reason.trim(), completionSummary: summary.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "例外完工失敗，請重試。");
      setBusy(false);
    }
  };

  return (
    <PilotCard className="mt-4 border-[var(--warm-red)]/30 bg-[var(--warm-red-soft)]/30">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black text-[var(--warm-red)]">例外完工</h2>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 px-2 text-sm font-bold text-ink-3"
        >
          關閉
        </button>
      </div>
      <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-ink-2">
        例外完工，非客戶簽認。此操作會跳過檢查表與照片條件，並留下獨立稽核紀錄；不代表客戶已確認完工。
      </p>

      <div className="mt-4 space-y-4">
        <Field label="例外完工原因（必填）" hint="會記錄於稽核事件供日後查閱。">
          <PilotTextarea
            value={reason}
            maxLength={2_000}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例：客戶臨時外出，由現場管委會代為確認"
          />
        </Field>
        <Field label="完工摘要（必填）">
          <PilotTextarea
            value={summary}
            maxLength={10_000}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="簡述實際完成的工作內容與現況"
          />
        </Field>
      </div>

      {error ? (
        <div className="mt-4">
          <PilotInlineNotice tone="error">{error}</PilotInlineNotice>
        </div>
      ) : null}

      <PilotButton
        variant="danger"
        className="mt-4 w-full"
        disabled={busy}
        onClick={submit}
      >
        {busy ? "處理中…" : "確認例外完工"}
      </PilotButton>
    </PilotCard>
  );
}
