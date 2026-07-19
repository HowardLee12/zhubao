"use client";

import { useState } from "react";

import { fetchOrganizationMembers, type OrganizationMember } from "./triage-api";
import { Field, PilotButton, PilotCard, PilotInlineNotice, PilotInput } from "./ui";
import {
  checkScheduleConflicts,
  type AssignmentDuty,
  type ScheduleConflict,
  type ScheduleWorkOrderInput,
} from "./work-order-api";
import { DUTY_LABELS } from "./work-order-format";

/**
 * Scheduling + assignment sheet. Picks a window and a roster, probes for
 * technician conflicts before committing, and (owner/admin only) exposes a
 * conflict-override reason so a manager can knowingly double-book. Plain
 * dispatchers cannot override — the DB re-enforces this authoritatively.
 */

interface RosterEntry {
  membershipId: string;
  duty: AssignmentDuty;
}

function toUtcIso(localValue: string): string | null {
  if (!localValue) return null;
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function WorkOrderAssignSheet({
  organizationId,
  workOrderId,
  canOverride,
  onCancel,
  onSchedule,
  loadMembers = fetchOrganizationMembers,
}: Readonly<{
  organizationId: string;
  workOrderId: string;
  canOverride: boolean;
  onCancel: () => void;
  onSchedule: (input: ScheduleWorkOrderInput) => Promise<void>;
  loadMembers?: (organizationId: string) => Promise<OrganizationMember[]>;
}>) {
  const [members, setMembers] = useState<OrganizationMember[] | null>(null);
  const [membersError, setMembersError] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ensureMembers = async () => {
    if (members) return;
    try {
      setMembers(await loadMembers(organizationId));
    } catch {
      setMembersError(true);
    }
  };

  const toggleMember = (membershipId: string) => {
    setRoster((current) => {
      const exists = current.some((entry) => entry.membershipId === membershipId);
      if (exists) return current.filter((entry) => entry.membershipId !== membershipId);
      const duty: AssignmentDuty = current.length === 0 ? "lead" : "technician";
      return [...current, { membershipId, duty }];
    });
    setConflicts([]);
  };

  const validWindow = (): { startsAt: string; endsAt: string } | null => {
    const startsAt = toUtcIso(start);
    const endsAt = toUtcIso(end);
    if (!startsAt || !endsAt) {
      setError("請填寫排程開始與結束時間。");
      return null;
    }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      setError("結束時間必須晚於開始時間。");
      return null;
    }
    if (roster.length === 0) {
      setError("請至少指派一位師傅。");
      return null;
    }
    return { startsAt, endsAt };
  };

  const probeConflicts = async () => {
    setError(null);
    const window = validWindow();
    if (!window) return;
    setBusy(true);
    try {
      const found = await checkScheduleConflicts(organizationId, {
        membershipIds: roster.map((entry) => entry.membershipId),
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        excludeWorkOrderId: workOrderId,
      });
      setConflicts(found);
      if (found.length === 0) setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "衝突偵測失敗，請重試。");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError(null);
    const window = validWindow();
    if (!window) return;
    if (conflicts.length > 0 && (!canOverride || overrideReason.trim() === "")) {
      setError(
        canOverride
          ? "偵測到排程衝突，請填寫覆寫原因後再確認。"
          : "偵測到排程衝突，需要管理者權限才能覆寫。",
      );
      return;
    }
    setBusy(true);
    try {
      await onSchedule({
        scheduledStartAt: window.startsAt,
        scheduledEndAt: window.endsAt,
        occurredAt: new Date().toISOString(),
        assignments: roster,
        conflictOverrideReason:
          conflicts.length > 0 && overrideReason.trim() ? overrideReason.trim() : null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "排程失敗，請重試。");
      setBusy(false);
    }
  };

  return (
    <PilotCard className="mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black text-ink">排程與指派</h2>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 px-2 text-sm font-bold text-ink-3"
        >
          關閉
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field>
          <label htmlFor="schedule-start" className="mb-1.5 block text-sm font-bold text-ink-2">
            開始時間
          </label>
          <PilotInput
            id="schedule-start"
            type="datetime-local"
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
              setConflicts([]);
            }}
          />
        </Field>
        <Field>
          <label htmlFor="schedule-end" className="mb-1.5 block text-sm font-bold text-ink-2">
            結束時間
          </label>
          <PilotInput
            id="schedule-end"
            type="datetime-local"
            value={end}
            onChange={(event) => {
              setEnd(event.target.value);
              setConflicts([]);
            }}
          />
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-bold text-ink-2">指派師傅</p>
        {members === null && !membersError ? (
          <PilotButton variant="secondary" className="w-full" onClick={ensureMembers}>
            載入可指派師傅
          </PilotButton>
        ) : null}
        {membersError ? (
          <PilotInlineNotice tone="error">無法載入師傅名單，請重試。</PilotInlineNotice>
        ) : null}
        {members ? (
          <ul className="space-y-2" aria-label="可指派師傅">
            {members.map((member) => {
              const entry = roster.find((r) => r.membershipId === member.id);
              return (
                <li
                  key={member.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-warm-border bg-white px-3 py-2"
                >
                  <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-orange"
                      checked={Boolean(entry)}
                      onChange={() => toggleMember(member.id)}
                    />
                    <span className="font-bold">{member.displayName}</span>
                  </label>
                  {entry ? (
                    <span className="rounded-full bg-orange-soft px-2 py-0.5 text-[11px] font-bold text-orange-deep">
                      {DUTY_LABELS[entry.duty]}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {conflicts.length > 0 ? (
        <div className="mt-4 rounded-xl border border-[var(--warm-red)]/30 bg-[var(--warm-red-soft)]/40 p-3">
          <p className="text-sm font-black text-[var(--warm-red)]">偵測到排程衝突</p>
          <ul className="mt-2 space-y-1 text-xs text-ink-2" aria-label="衝突清單">
            {conflicts.map((conflict) => (
              <li key={`${conflict.membershipId}-${conflict.workOrderId}`}>
                • 師傅已被工單 {conflict.workOrderNo} 佔用
              </li>
            ))}
          </ul>
          {canOverride ? (
            <div className="mt-3">
              <Field label="覆寫原因（管理者）" hint="覆寫會被記錄於稽核事件。">
                <PilotInput
                  value={overrideReason}
                  maxLength={2_000}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  placeholder="例：客戶指定此時段，已與師傅確認"
                />
              </Field>
            </div>
          ) : (
            <p className="mt-2 text-xs font-bold text-[var(--warm-red)]">
              需要管理者權限才能覆寫衝突。
            </p>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <PilotInlineNotice tone="error">{error}</PilotInlineNotice>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <PilotButton
          variant="secondary"
          className="flex-1"
          disabled={busy}
          onClick={probeConflicts}
        >
          檢查衝突
        </PilotButton>
        <PilotButton className="flex-[2]" disabled={busy} onClick={submit}>
          {busy ? "處理中…" : "確認排程"}
        </PilotButton>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-ink-3">
        排程通知尚未自動發送（將於下一階段開放）。
      </p>
    </PilotCard>
  );
}
