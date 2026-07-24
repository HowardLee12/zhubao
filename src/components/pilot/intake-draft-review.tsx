"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ExtractionField, ExtractionFields } from "@/schemas/ai-extraction";
import type { IntakeDraftDetail, IntakeDraftMessage } from "@/schemas/intake-draft";

import {
  confirmIntakeDraft,
  createIdempotencyKey,
  dismissIntakeDraft,
  fetchIntakeDraftDetail,
  fetchPilotSession,
  PilotApiError,
} from "./api";
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
  PilotTextarea,
} from "./ui";

const DISPATCH_ROLES = new Set(["owner", "admin", "dispatcher"]);

// The editable structured fields the reviewer confirms. subject/description are the
// two canonical fields the confirm RPC reads; extra AI fields are shown read-only so
// nothing the model produced is hidden, but only these two feed the service_request.
const EDITABLE_FIELDS: ReadonlyArray<{ key: string; label: string; multiline?: boolean }> = [
  { key: "subject", label: "主旨" },
  { key: "description", label: "問題與需求說明", multiline: true },
];

type LoadStatus = "loading" | "ready" | "error" | "restricted";

interface EditableValue {
  value: string;
  originalValue: string;
  source: ExtractionField["source"];
  confidence: number | null;
}

type Outcome =
  | { kind: "none" }
  | { kind: "confirmed"; serviceRequestId: string; requestNo: string }
  | { kind: "dismissed" };

function sourceLabel(source: ExtractionField["source"]): string {
  return source === "ai" ? "AI 推斷" : source === "line" ? "LINE 原文" : "人工填寫";
}

function confidenceLabel(confidence: number | null): string | null {
  if (confidence === null) return null;
  return `信心 ${Math.round(confidence * 100)}%`;
}

function messageTypeLabel(type: IntakeDraftMessage["messageType"]): string {
  return type === "image"
    ? "圖片"
    : type === "sticker"
      ? "貼圖"
      : type === "other"
        ? "其他訊息"
        : "文字";
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

// Seed the editable form from the AI/manual fields. A manual draft may carry no
// fields at all (AI degraded); the reviewer types them in from scratch.
function seedEditable(fields: ExtractionFields): Record<string, EditableValue> {
  const seeded: Record<string, EditableValue> = {};
  for (const { key } of EDITABLE_FIELDS) {
    const field = fields[key];
    const value = field?.value ?? "";
    seeded[key] = {
      value,
      originalValue: value,
      source: field?.source ?? "manual",
      confidence: field?.confidence ?? null,
    };
  }
  return seeded;
}

export function PilotIntakeDraftReview({ draftId }: Readonly<{ draftId: string }>) {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IntakeDraftDetail | null>(null);
  const [editable, setEditable] = useState<Record<string, EditableValue>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setLoadStatus("loading");
    setActionError(null);
    try {
      const session = await fetchPilotSession();
      const membership = session.memberships.find((m) => m.status === "active");
      if (!membership || !DISPATCH_ROLES.has(membership.role)) {
        setLoadStatus("restricted");
        return;
      }
      const loaded = await fetchIntakeDraftDetail(membership.organizationId, draftId);
      setOrganizationId(membership.organizationId);
      setDetail(loaded);
      setEditable(seedEditable(loaded.fields));
      if (loaded.convertedServiceRequestId) {
        setOutcome({
          kind: "confirmed",
          serviceRequestId: loaded.convertedServiceRequestId,
          requestNo: loaded.title ?? "",
        });
      } else {
        setOutcome({ kind: "none" });
      }
      setLoadStatus("ready");
    } catch (error) {
      if (error instanceof PilotApiError && error.status === 403) {
        setLoadStatus("restricted");
        return;
      }
      setLoadStatus("error");
    }
  }, [draftId]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const setFieldValue = useCallback((key: string, next: string) => {
    setEditable((current) => {
      const field = current[key];
      if (!field) return current;
      // An edited value becomes a manual override; an untouched one keeps its
      // original AI/LINE provenance.
      const edited = next !== field.originalValue;
      return {
        ...current,
        [key]: {
          ...field,
          value: next,
          source: edited ? "manual" : field.source,
          confidence: edited ? null : field.confidence,
        },
      };
    });
  }, []);

  const overrides = useMemo<ExtractionFields>(() => {
    const built: ExtractionFields = {};
    for (const { key } of EDITABLE_FIELDS) {
      const field = editable[key];
      if (!field) continue;
      built[key] = {
        value: field.value,
        source: field.source,
        confidence: field.confidence,
      };
    }
    return built;
  }, [editable]);

  const onConfirm = useCallback(async () => {
    if (!organizationId || !detail) return;
    setBusy(true);
    setActionError(null);
    try {
      const envelope = await confirmIntakeDraft(
        organizationId,
        draftId,
        detail.lockVersion,
        createIdempotencyKey(),
        { fieldOverrides: overrides },
      );
      setOutcome({
        kind: "confirmed",
        serviceRequestId: envelope.serviceRequestId,
        requestNo: envelope.requestNo,
      });
    } catch (error) {
      setActionError(
        error instanceof PilotApiError
          ? error.message
          : "建立服務案件時發生問題，請稍後再試。",
      );
    } finally {
      setBusy(false);
    }
  }, [organizationId, detail, draftId, overrides]);

  const onDismiss = useCallback(async () => {
    if (!organizationId || !detail) return;
    setBusy(true);
    setActionError(null);
    try {
      await dismissIntakeDraft(organizationId, draftId, detail.lockVersion, "unparseable");
      setOutcome({ kind: "dismissed" });
    } catch (error) {
      setActionError(
        error instanceof PilotApiError ? error.message : "忽略進件時發生問題，請稍後再試。",
      );
    } finally {
      setBusy(false);
    }
  }, [organizationId, detail, draftId]);

  if (loadStatus === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="待確認 · LINE" />
        <PilotLoading label="正在載入 LINE 進件草稿" />
      </PilotPage>
    );
  }

  if (loadStatus === "restricted") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="待確認 · LINE" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-xl font-black text-ink">沒有處理進件的權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            LINE 進件草稿只開放給有派工權限的成員（負責人、管理員或派工員）。
          </p>
          <Link
            href="/app/my-work-orders"
            className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-orange px-4 text-sm font-bold text-white"
          >
            前往我的工單 →
          </Link>
        </PilotCard>
      </PilotPage>
    );
  }

  if (loadStatus === "error" || !detail) {
    return (
      <PilotPage>
        <PilotBrand eyebrow="待確認 · LINE" />
        <PilotError
          title="讀不到這筆 LINE 進件"
          description="原始訊息仍保存在系統中，不會遺失。請確認網路後重新載入。"
          actionLabel="重新載入"
          onRetry={() => setAttempt((n) => n + 1)}
        />
      </PilotPage>
    );
  }

  const degraded = detail.origin === "manual";
  const overallConfidence = confidenceLabel(detail.confidence);

  return (
    <PilotPage>
      <PilotBrand eyebrow="待確認 · LINE" />

      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-orange-soft px-2.5 py-1 text-[11px] font-bold text-orange-deep">
            待確認 · LINE
          </span>
          {overallConfidence ? (
            <span className="rounded-full bg-bg-warm px-2.5 py-1 text-[11px] font-bold text-ink-2">
              {overallConfidence}
            </span>
          ) : null}
        </div>
        <h1 className="mt-2 text-[26px] font-black tracking-[-0.03em] text-ink">
          {detail.title ?? "LINE 進件草稿"}
        </h1>
      </header>

      {degraded ? (
        <div className="mb-4">
          <PilotInlineNotice tone="info">
            AI 整理失敗，可手動處理。原始訊息完整保留，請自行填寫主旨與需求說明後建立案件。
          </PilotInlineNotice>
        </div>
      ) : null}

      {outcome.kind === "confirmed" ? (
        <PilotCard className="mb-4">
          <PilotInlineNotice tone="success">已建立服務案件，可前往整理進件。</PilotInlineNotice>
          <p className="mt-3 text-sm font-bold text-ink">{outcome.requestNo}</p>
          <Link
            href={`/app/inbox/${outcome.serviceRequestId}`}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-orange px-4 text-sm font-bold text-white"
          >
            前往整理進件 →
          </Link>
        </PilotCard>
      ) : null}

      {outcome.kind === "dismissed" ? (
        <PilotCard className="mb-4">
          <PilotInlineNotice tone="info">已忽略這筆 LINE 進件。</PilotInlineNotice>
          <Link
            href="/app/inbox"
            className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-warm-border-strong bg-white px-4 text-sm font-bold text-ink"
          >
            返回接案匣
          </Link>
        </PilotCard>
      ) : null}

      {/* Immutable original messages (verbatim, read-only). */}
      <PilotCard className="mb-4">
        <h2 className="text-lg font-black text-ink">原始訊息</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">
          此區塊為 LINE 原始訊息，不可修改，作為送出當下的存證。
        </p>
        <ol className="mt-4 space-y-3">
          {detail.messages.map((message) => (
            <li
              key={message.id}
              className="rounded-2xl border border-warm-border bg-[#fbf8f3] p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-orange-deep">
                  {messageTypeLabel(message.messageType)}
                </span>
                <span className="text-[11px] font-semibold text-ink-3">
                  {formatTime(message.receivedAt)}
                </span>
              </div>
              {message.text ? (
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-ink-2">
                  {message.text}
                </p>
              ) : null}
              {message.attachments.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {message.attachments.map((attachment) => (
                    <li
                      key={attachment.id}
                      className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-3"
                    >
                      圖片附件（{attachment.status}）
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </PilotCard>

      {/* AI-extracted fields with per-field provenance + confidence (read-only view). */}
      {Object.keys(detail.fields).length > 0 ? (
        <PilotCard className="mb-4">
          <h2 className="text-lg font-black text-ink">AI 擷取欄位</h2>
          <dl className="mt-3 space-y-2.5">
            {Object.entries(detail.fields).map(([key, field]) => (
              <div key={key} className="rounded-2xl bg-bg-warm p-3">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-xs font-bold text-ink-3">{key}</dt>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-orange-deep">
                      {sourceLabel(field.source)}
                    </span>
                    {confidenceLabel(field.confidence) ? (
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-ink-2">
                        {confidenceLabel(field.confidence)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{field.value}</dd>
              </div>
            ))}
          </dl>
        </PilotCard>
      ) : null}

      {detail.missingFields.length > 0 ? (
        <PilotCard className="mb-4">
          <h2 className="text-sm font-black text-ink">尚缺欄位</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {detail.missingFields.map((missing) => (
              <li
                key={missing}
                className="rounded-full bg-[var(--warm-red-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--warm-red)]"
              >
                {missing}
              </li>
            ))}
          </ul>
        </PilotCard>
      ) : null}

      {/* Editable structured form + confirm/dismiss actions. */}
      {outcome.kind === "none" ? (
        <PilotCard>
          <h2 className="text-lg font-black text-ink">整理後摘要</h2>
          <p className="mt-1 text-xs leading-5 text-ink-3">
            確認或修改後建立服務案件，接著就能像一般進件一樣整理與轉換。
          </p>
          <div className="mt-4 space-y-3">
            {EDITABLE_FIELDS.map(({ key, label, multiline }) => (
              <Field key={key} label={label}>
                {multiline ? (
                  <PilotTextarea
                    aria-label={label}
                    value={editable[key]?.value ?? ""}
                    onChange={(event) => setFieldValue(key, event.target.value)}
                  />
                ) : (
                  <PilotInput
                    aria-label={label}
                    value={editable[key]?.value ?? ""}
                    onChange={(event) => setFieldValue(key, event.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>

          {actionError ? (
            <div className="mt-4">
              <PilotInlineNotice tone="error">{actionError}</PilotInlineNotice>
            </div>
          ) : null}

          <div className="mt-5 space-y-2.5">
            <PilotButton className="w-full" disabled={busy} onClick={() => void onConfirm()}>
              {busy ? "處理中…" : "建立服務案件"}
            </PilotButton>
            <PilotButton
              variant="danger"
              className="w-full"
              disabled={busy}
              onClick={() => void onDismiss()}
            >
              忽略此進件（無法解析／垃圾訊息）
            </PilotButton>
          </div>
        </PilotCard>
      ) : null}
    </PilotPage>
  );
}
