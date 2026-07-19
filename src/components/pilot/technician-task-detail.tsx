"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchPilotSession } from "./api";
import {
  Field,
  PilotBrand,
  PilotButton,
  PilotCard,
  PilotError,
  PilotInlineNotice,
  PilotLoading,
  PilotPage,
  PilotTextarea,
} from "./ui";
import { ChecklistItemInput, PhotoCaptureButton } from "./technician-task-inputs";
import {
  captureWorkOrderPhoto,
  fetchWorkOrderDetail,
  PilotApiError,
  respondToChecklistItem,
  transitionWorkOrder,
  type ChecklistItem,
  type PhotoCategory,
  type WorkOrderDetail,
} from "./work-order-api";
import {
  completionBlockers,
  formatTimeRange,
  nextFieldAction,
  photoCategoryLabel,
  resolvePhotoItemResponse,
  statusLabel,
  type CompletionBlocker,
} from "./work-order-format";

type LoadStatus = "loading" | "ready" | "error";

interface DetailState {
  status: LoadStatus;
  organizationId: string | null;
  detail: WorkOrderDetail | null;
}

const CAPTURE_CATEGORIES: { category: PhotoCategory; label: string }[] = [
  { category: "before", label: "施工前" },
  { category: "after", label: "施工後" },
  { category: "issue", label: "異常" },
];

export function TechnicianTaskDetail({ workOrderId }: Readonly<{ workOrderId: string }>) {
  const [state, setState] = useState<DetailState>({
    status: "loading",
    organizationId: null,
    detail: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<CompletionBlocker[]>([]);
  // sha256 dedupe cache: re-selecting the identical file for a category never
  // re-uploads (mirrors the public intake dedupe cache).
  const uploaded = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setState({ status: "loading", organizationId: null, detail: null });
    setError(null);
    setBlockers([]);
    try {
      const session = await fetchPilotSession();
      const membership = session.memberships.find((m) => m.status === "active");
      if (!membership) throw new Error("尚未建立工作空間");
      const detail = await fetchWorkOrderDetail(membership.organizationId, workOrderId);
      setState({ status: "ready", organizationId: membership.organizationId, detail });
      setSummary(detail.completionSummary ?? "");
    } catch {
      setState({ status: "error", organizationId: null, detail: null });
    }
  }, [workOrderId]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  // Reload the server truth. Every optimistic mutation reconciles against this so
  // a failed action never leaves a fabricated success on screen.
  const refresh = useCallback(async () => {
    if (!state.organizationId) return;
    const detail = await fetchWorkOrderDetail(state.organizationId, workOrderId);
    setState((current) => ({ ...current, status: "ready", detail }));
  }, [state.organizationId, workOrderId]);

  const runFieldAction = async (
    action: "enRoute" | "arrive" | "pause" | "resume" | "complete",
  ) => {
    const detail = state.detail;
    if (!detail || !state.organizationId) return;
    setError(null);
    setProgress(null);

    if (action === "complete") {
      const missing = completionBlockers(detail, summary);
      if (missing.length > 0) {
        setBlockers(missing);
        setError("尚未達成完工條件，請補齊下列項目後再回報完工。");
        return;
      }
    }

    setBusy(true);
    try {
      await transitionWorkOrder(state.organizationId, workOrderId, detail.lockVersion, action, {
        completionSummary: action === "complete" ? summary.trim() : undefined,
      });
      setBlockers([]);
      await refresh();
    } catch (cause) {
      if (cause instanceof PilotApiError && cause.status === 412) {
        // Stale lock: reconcile to server truth then ask the crew to retry.
        await refresh();
        setError("工單狀態已在其他裝置更新，畫面已同步，請確認後再操作一次。");
      } else {
        setError(cause instanceof Error ? cause.message : "操作失敗，請稍後再試。");
      }
    } finally {
      setBusy(false);
    }
  };

  const capturePhoto = async (
    file: File,
    category: PhotoCategory,
    checklistItemId: string | null,
  ) => {
    if (!state.organizationId) return;
    setError(null);
    setBusy(true);
    setProgress(`正在上傳${photoCategoryLabel(category)}照片…`);
    try {
      const cacheKey = `${category}:${checklistItemId ?? "none"}:${file.name}:${file.size}:${file.lastModified}`;
      if (!uploaded.current.has(cacheKey)) {
        const result = await captureWorkOrderPhoto(
          state.organizationId,
          workOrderId,
          file,
          category,
          { checklistItemId },
        );
        uploaded.current.set(cacheKey, result.photoId);
      }
      const fresh = await fetchWorkOrderDetail(state.organizationId, workOrderId);
      setState((current) => ({ ...current, status: "ready", detail: fresh }));
      // A photo-type checklist item is answered by its evidence, not by text:
      // record the ready photo ids as the item's response so the DB completion
      // gate sees a non-null response and does not raise
      // REQUIRED_CHECKLIST_INCOMPLETE forever.
      await respondPhotoItem(fresh, checklistItemId);
      setBlockers([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "照片上傳失敗，請重試。");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // For a photo-type checklist item, mirror its ready evidence into the item's
  // response via respond_to_checklist_item (which accepts a JSON array for
  // 'photo'). A failure here is swallowed: the photo itself uploaded fine, and
  // the completion gate still surfaces the unanswered item on the next attempt.
  const respondPhotoItem = async (fresh: WorkOrderDetail, checklistItemId: string | null) => {
    if (!state.organizationId) return;
    const resolved = resolvePhotoItemResponse(fresh, checklistItemId);
    if (!resolved) return;
    try {
      await respondToChecklistItem(
        state.organizationId,
        resolved.checklistId,
        resolved.itemId,
        fresh.lockVersion,
        resolved.photoIds,
      );
      const reconciled = await fetchWorkOrderDetail(state.organizationId, workOrderId);
      setState((current) => ({ ...current, status: "ready", detail: reconciled }));
    } catch {
      // Non-fatal: the upload succeeded; the completion gate will re-prompt.
    }
  };

  const respondItem = async (item: ChecklistItem, checklistId: string, value: unknown) => {
    const detail = state.detail;
    if (!detail || !state.organizationId) return;
    setError(null);
    setBusy(true);
    try {
      await respondToChecklistItem(
        state.organizationId,
        checklistId,
        item.id,
        detail.lockVersion,
        value,
      );
      await refresh();
      setBlockers([]);
    } catch (cause) {
      if (cause instanceof PilotApiError && cause.status === 412) {
        await refresh();
        setError("工單已更新，畫面已同步，請重新作答。");
      } else {
        setError(cause instanceof Error ? cause.message : "作答失敗，請重試。");
      }
    } finally {
      setBusy(false);
    }
  };

  if (state.status === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="現場工單" />
        <PilotLoading label="正在載入工單內容" />
      </PilotPage>
    );
  }

  if (state.status === "error" || !state.detail) {
    return (
      <PilotPage>
        <PilotBrand eyebrow="現場工單" />
        <PilotError
          title="無法載入工單"
          description="工單可能尚未指派給你，或連線暫時中斷。你的資料不會因此被修改。"
          actionLabel="重新載入"
          onRetry={() => setAttempt((current) => current + 1)}
        />
        <Link href="/app/my-work-orders" className="mt-4 block text-center text-sm font-bold text-orange">
          返回我的工單
        </Link>
      </PilotPage>
    );
  }

  const detail = state.detail;
  const primary = nextFieldAction(detail.status);
  const isTerminal = detail.status === "completed" || detail.status === "cancelled";

  return (
    <PilotPage>
      <PilotBrand eyebrow="現場工單" />
      <Link href="/app/my-work-orders" className="mb-3 inline-flex text-sm font-bold text-ink-3">
        ← 我的工單
      </Link>

      <PilotCard>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight text-ink">{detail.title}</h1>
            <p className="mt-0.5 font-mono text-xs text-ink-3">{detail.workOrderNo}</p>
          </div>
          <span className="shrink-0 rounded-full bg-orange-soft px-3 py-1 text-xs font-bold text-orange-deep">
            {statusLabel(detail.status)}
          </span>
        </div>
        <p className="mt-3 text-sm text-ink-2">
          {formatTimeRange(detail.scheduledStartAt, detail.scheduledEndAt)}
        </p>
        {detail.description ? (
          <p className="mt-2 text-sm leading-6 text-ink-2">{detail.description}</p>
        ) : null}
        {detail.customerNotes ? (
          <p className="mt-2 rounded-xl bg-bg-warm px-3 py-2 text-xs leading-5 text-ink-2">
            客戶備註：{detail.customerNotes}
          </p>
        ) : null}
      </PilotCard>

      {progress ? (
        <div className="mt-4">
          <PilotInlineNotice tone="info">{progress}</PilotInlineNotice>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <PilotInlineNotice tone="error">{error}</PilotInlineNotice>
        </div>
      ) : null}

      {blockers.length > 0 ? (
        <div className="mt-4">
          <PilotCard className="border-[var(--warm-red)]/30 bg-[var(--warm-red-soft)]/40">
            <p className="text-sm font-black text-[var(--warm-red)]">尚未達成完工條件</p>
            <ul className="mt-2 space-y-1.5" aria-label="待補齊項目">
              {blockers.map((blocker) => (
                <li key={`${blocker.code}-${blocker.itemId ?? ""}`} className="text-sm text-ink-2">
                  • {blocker.message}
                </li>
              ))}
            </ul>
          </PilotCard>
        </div>
      ) : null}

      {detail.checklists.map((checklist) => (
        <div className="mt-4" key={checklist.id}>
          <PilotCard>
            <h2 className="text-base font-black text-ink">{checklist.name}</h2>
            <ul className="mt-3 space-y-4">
              {checklist.items.map((item) => (
                <li key={item.id}>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-ink-2">{item.label}</p>
                    {item.isRequired ? (
                      <span className="rounded-full bg-orange-soft px-2 py-0.5 text-[10px] font-bold text-orange-deep">
                        必填
                      </span>
                    ) : null}
                    {item.response !== null && item.response !== undefined ? (
                      <span className="text-xs font-bold text-[var(--warm-green)]">已填</span>
                    ) : null}
                  </div>
                  {!isTerminal ? (
                    <ChecklistItemInput
                      item={item}
                      disabled={busy}
                      onRespond={(value) => respondItem(item, checklist.id, value)}
                      onCapture={(file) => capturePhoto(file, "issue", item.id)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </PilotCard>
        </div>
      ))}

      {!isTerminal ? (
        <div className="mt-4">
          <PilotCard>
            <h2 className="text-base font-black text-ink">現場照片</h2>
            <p className="mt-1 text-xs text-ink-3">完工需要至少一張施工前與施工後照片。</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {CAPTURE_CATEGORIES.map(({ category, label }) => (
                <PhotoCaptureButton
                  key={category}
                  label={label}
                  disabled={busy}
                  count={detail.photos.filter((p) => p.category === category && p.status === "ready").length}
                  onSelect={(file) => capturePhoto(file, category, null)}
                />
              ))}
            </div>
          </PilotCard>
        </div>
      ) : null}

      {detail.status === "on_site" || detail.status === "paused" ? (
        <div className="mt-4">
          <PilotCard>
            <Field label="完工摘要" hint="會顯示給店家與客戶，請簡述處理內容與結果。">
              <PilotTextarea
                value={summary}
                maxLength={10_000}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="例：已完成兩台冷氣清洗，運轉正常，濾網更換。"
              />
            </Field>
          </PilotCard>
        </div>
      ) : null}

      {primary && !isTerminal ? (
        <div className="sticky bottom-4 mt-5">
          <div className="flex gap-2">
            {detail.status === "on_site" ? (
              <PilotButton
                variant="secondary"
                className="min-h-14 flex-1"
                disabled={busy}
                onClick={() => runFieldAction("pause")}
              >
                暫停
              </PilotButton>
            ) : null}
            <PilotButton
              className="min-h-14 flex-[2]"
              disabled={busy}
              onClick={() => runFieldAction(primary.action)}
            >
              {busy ? "處理中…" : primary.label}
            </PilotButton>
          </div>
        </div>
      ) : null}

      {detail.status === "completed" ? (
        <div className="mt-5">
          <PilotInlineNotice tone="success">
            此工單已完工。完工通知尚未自動發送（將於下一階段開放）。
          </PilotInlineNotice>
        </div>
      ) : null}
    </PilotPage>
  );
}
