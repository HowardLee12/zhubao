"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { fetchPilotSession, type PilotMembership } from "./api";
import { ForceCompleteSheet } from "./force-complete-sheet";
import {
  PilotBrand,
  PilotButton,
  PilotCard,
  PilotError,
  PilotInlineNotice,
  PilotLoading,
  PilotPage,
} from "./ui";
import { WorkOrderAssignSheet } from "./work-order-assign-sheet";
import {
  fetchWorkOrderDetail,
  forceCompleteWorkOrder,
  PilotApiError,
  scheduleWorkOrder,
  ScheduleConflictError,
  transitionWorkOrder,
  type ForceCompleteInput,
  type ScheduleWorkOrderInput,
  type WorkOrderDetail,
} from "./work-order-api";
import {
  ASSIGNMENT_STATUS_LABELS,
  DUTY_LABELS,
  formatTimeRange,
  isActiveAssignmentStatus,
  MANAGER_ROLES,
  OWNER_ROLES,
  photoCategoryLabel,
  statusLabel,
} from "./work-order-format";

type LoadStatus = "loading" | "ready" | "error" | "restricted";

interface DetailState {
  status: LoadStatus;
  organizationId: string | null;
  role: string | null;
  detail: WorkOrderDetail | null;
}

export function DispatcherWorkOrderDetail({ workOrderId }: Readonly<{ workOrderId: string }>) {
  const [state, setState] = useState<DetailState>({
    status: "loading",
    organizationId: null,
    role: null,
    detail: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState<"none" | "schedule" | "force">("none");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading", organizationId: null, role: null, detail: null });
    setError(null);
    try {
      const session = await fetchPilotSession();
      const membership: PilotMembership | undefined = session.memberships.find(
        (m) => m.status === "active",
      );
      if (!membership) throw new Error("尚未建立工作空間");
      if (!MANAGER_ROLES.has(membership.role)) {
        setState({
          status: "restricted",
          organizationId: membership.organizationId,
          role: membership.role,
          detail: null,
        });
        return;
      }
      const detail = await fetchWorkOrderDetail(membership.organizationId, workOrderId);
      setState({
        status: "ready",
        organizationId: membership.organizationId,
        role: membership.role,
        detail,
      });
    } catch {
      setState({ status: "error", organizationId: null, role: null, detail: null });
    }
  }, [workOrderId]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const refresh = useCallback(async () => {
    if (!state.organizationId) return;
    const detail = await fetchWorkOrderDetail(state.organizationId, workOrderId);
    setState((current) => ({ ...current, detail }));
  }, [state.organizationId, workOrderId]);

  const doSchedule = async (input: ScheduleWorkOrderInput) => {
    if (!state.organizationId || !state.detail) return;
    try {
      const result = await scheduleWorkOrder(
        state.organizationId,
        workOrderId,
        state.detail.lockVersion,
        input,
      );
      setSheet("none");
      setNotice(`已排程並派工。${notificationLabel(result.notification.status)}`);
      await refresh();
    } catch (cause) {
      if (cause instanceof ScheduleConflictError) {
        // The sheet re-renders conflicts via its own probe; surface a hint here.
        throw cause;
      }
      if (cause instanceof PilotApiError && cause.status === 412) {
        await refresh();
        throw new PilotApiError("工單已更新，畫面已同步，請重新確認排程。", 412);
      }
      throw cause;
    }
  };

  const doDispatch = async () => {
    if (!state.organizationId || !state.detail) return;
    setError(null);
    try {
      const result = await transitionWorkOrder(
        state.organizationId,
        workOrderId,
        state.detail.lockVersion,
        "dispatch",
      );
      setNotice(`已派工。${notificationLabel(result.notification.status)}`);
      await refresh();
    } catch (cause) {
      if (cause instanceof PilotApiError && cause.status === 412) {
        await refresh();
        setError("工單已更新，畫面已同步，請重新確認。");
      } else {
        setError(cause instanceof Error ? cause.message : "派工失敗，請重試。");
      }
    }
  };

  const doForceComplete = async (input: ForceCompleteInput) => {
    if (!state.organizationId || !state.detail) return;
    const result = await forceCompleteWorkOrder(
      state.organizationId,
      workOrderId,
      state.detail.lockVersion,
      input,
    );
    setSheet("none");
    setNotice(`已例外完工（非客戶簽認）。${notificationLabel(result.notification.status)}`);
    await refresh();
  };

  if (state.status === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="工單工作台" />
        <PilotLoading label="正在載入工單" />
      </PilotPage>
    );
  }

  if (state.status === "restricted") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="工單工作台" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">你沒有派工權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            派工工作台僅開放給負責人、管理員與派工人員。若你是師傅，請到「我的工單」查看指派給你的工單。
          </p>
          <Link
            href="/app/my-work-orders"
            className="mt-4 inline-flex min-h-11 items-center text-sm font-bold text-orange"
          >
            前往我的工單
          </Link>
        </PilotCard>
      </PilotPage>
    );
  }

  if (state.status === "error" || !state.detail) {
    return (
      <PilotPage>
        <PilotBrand eyebrow="工單工作台" />
        <PilotError
          title="無法載入工單"
          description="連線可能暫時中斷。你的資料不會因此被修改，請重新確認一次。"
          actionLabel="重新載入"
          onRetry={() => setAttempt((current) => current + 1)}
        />
      </PilotPage>
    );
  }

  const detail = state.detail;
  const canOverride = OWNER_ROLES.has(state.role ?? "");
  const canForceComplete =
    canOverride && (detail.status === "on_site" || detail.status === "paused");
  const activeAssignments = detail.assignments.filter((a) => isActiveAssignmentStatus(a.status));

  return (
    <PilotPage>
      <PilotBrand eyebrow="工單工作台" />
      <Link href="/app/schedule" className="mb-3 inline-flex text-sm font-bold text-ink-3">
        ← 排程板
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
        {detail.internalNotes ? (
          <p className="mt-2 rounded-xl bg-bg-warm px-3 py-2 text-xs leading-5 text-ink-2">
            內部備註：{detail.internalNotes}
          </p>
        ) : null}
      </PilotCard>

      {notice ? (
        <div className="mt-4">
          <PilotInlineNotice tone="success">{notice}</PilotInlineNotice>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <PilotInlineNotice tone="error">{error}</PilotInlineNotice>
        </div>
      ) : null}

      <div className="mt-4">
        <PilotCard>
          <h2 className="text-base font-black text-ink">指派師傅</h2>
          {activeAssignments.length === 0 ? (
            <p className="mt-2 text-sm text-ink-3">尚未指派師傅。</p>
          ) : (
            <ul className="mt-3 space-y-2" aria-label="指派名單">
              {activeAssignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-warm-border bg-white px-3 py-2 text-sm"
                >
                  <span className="font-bold text-ink-2">
                    {assignment.memberName ?? "師傅"}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-ink-3">
                    <span>{DUTY_LABELS[assignment.duty] ?? assignment.duty}</span>
                    <span className="rounded-full bg-bg-warm px-2 py-0.5 font-bold">
                      {ASSIGNMENT_STATUS_LABELS[assignment.status] ?? assignment.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PilotCard>
      </div>

      {detail.checklists.length > 0 ? (
        <div className="mt-4">
          <PilotCard>
            <h2 className="text-base font-black text-ink">檢查表</h2>
            {detail.checklists.map((checklist) => (
              <div key={checklist.id} className="mt-3">
                <p className="text-sm font-bold text-ink-2">
                  {checklist.name}
                  <span className="ml-2 text-xs font-bold text-ink-3">
                    {checklist.status === "completed" ? "已完成" : "進行中"}
                  </span>
                </p>
                <ul className="mt-1.5 space-y-1 text-xs text-ink-3">
                  {checklist.items.map((item) => (
                    <li key={item.id}>
                      {item.label}
                      {item.isRequired ? "（必填）" : ""}：
                      {item.response !== null && item.response !== undefined ? "已填" : "未填"}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </PilotCard>
        </div>
      ) : null}

      <div className="mt-4">
        <PilotCard>
          <h2 className="text-base font-black text-ink">現場照片</h2>
          {detail.photos.filter((p) => p.status === "ready").length === 0 ? (
            <p className="mt-2 text-sm text-ink-3">尚未上傳照片。</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="照片清單">
              {detail.photos
                .filter((photo) => photo.status === "ready")
                .map((photo) => (
                  <li
                    key={photo.id}
                    className="rounded-full bg-bg-warm px-3 py-1 text-xs font-bold text-ink-2"
                  >
                    {photoCategoryLabel(photo.category)}
                  </li>
                ))}
            </ul>
          )}
        </PilotCard>
      </div>

      {sheet === "schedule" && state.organizationId ? (
        <WorkOrderAssignSheet
          organizationId={state.organizationId}
          workOrderId={workOrderId}
          canOverride={canOverride}
          onCancel={() => setSheet("none")}
          onSchedule={doSchedule}
        />
      ) : null}

      {sheet === "force" ? (
        <ForceCompleteSheet
          onCancel={() => setSheet("none")}
          onForceComplete={doForceComplete}
        />
      ) : null}

      {sheet === "none" ? (
        <div className="mt-5 space-y-2">
          {detail.status === "draft" ? (
            <PilotButton className="w-full" onClick={() => setSheet("schedule")}>
              排程並指派
            </PilotButton>
          ) : null}
          {detail.status === "scheduled" ? (
            <PilotButton className="w-full" onClick={doDispatch}>
              派工給師傅
            </PilotButton>
          ) : null}
          {canForceComplete ? (
            <PilotButton
              variant="secondary"
              className="w-full"
              onClick={() => setSheet("force")}
            >
              例外完工（非客戶簽認）
            </PilotButton>
          ) : null}
        </div>
      ) : null}
    </PilotPage>
  );
}

function notificationLabel(status: string): string {
  return status === "not_sent" ? "通知尚未自動發送（下一階段開放）。" : "";
}
