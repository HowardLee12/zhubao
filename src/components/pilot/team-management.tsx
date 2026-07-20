"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ensureCsrfToken, fetchPilotSession, PilotApiError } from "./api";
import type { OrganizationMember } from "./triage-api";
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
  PilotSelect,
} from "./ui";

/**
 * Invite input for a new operational member. The backend provisions the
 * auth-user binding; the pilot UI only collects who they are and what they do.
 * Owner cannot be created through this path — the org's single owner is set at
 * organization creation and protected by a DB guard trigger.
 */
export interface InviteMemberInput {
  displayName: string;
  email: string;
  role: "admin" | "dispatcher" | "technician";
}

export type LoadMembers = (
  organizationId: string,
) => Promise<OrganizationMember[]>;

export type InviteMember = (
  organizationId: string,
  input: InviteMemberInput,
) => Promise<OrganizationMember>;

const MANAGER_ROLES = new Set(["owner", "admin", "dispatcher"]);

const ROLE_LABELS: Record<OrganizationMember["role"], string> = {
  owner: "負責人",
  admin: "管理員",
  dispatcher: "派工員",
  technician: "技師",
};

const STATUS_LABELS: Record<OrganizationMember["status"], string> = {
  invited: "已邀請",
  active: "使用中",
  suspended: "已停用",
  removed: "已移除",
};

const STATUS_TONES: Record<OrganizationMember["status"], string> = {
  invited: "bg-orange-soft text-orange-deep",
  active: "bg-[var(--warm-green-soft)] text-[var(--warm-green)]",
  suspended: "bg-bg-warm text-ink-3",
  removed: "bg-bg-warm text-ink-3",
};

const INVITABLE_ROLES: readonly InviteMemberInput["role"][] = [
  "technician",
  "dispatcher",
  "admin",
];

const JSON_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
} as const;

function orgPath(organizationId: string): string {
  return `/api/v2/organizations/${encodeURIComponent(organizationId)}`;
}

/**
 * Default seam — the real GET `?scope=all` members read. Injected as a prop so
 * the component stays unit-testable without stubbing global fetch; the page
 * wires this default implementation.
 */
export const fetchAllMembers: LoadMembers = async (organizationId) => {
  const response = await fetch(`${orgPath(organizationId)}/members?scope=all`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const body = (await response.json().catch(() => null)) as
    | { data: OrganizationMember[] }
    | { title?: string; detail?: string }
    | null;
  if (!response.ok) {
    const problem = body as { title?: string; detail?: string } | null;
    throw new PilotApiError(
      problem?.detail ?? problem?.title ?? "服務暫時無法使用，請稍後再試。",
      response.status,
    );
  }
  return (body as { data: OrganizationMember[] }).data;
};

/** Default seam — the real POST invite. */
export const invitePilotMember: InviteMember = async (organizationId, input) => {
  const response = await fetch(`${orgPath(organizationId)}/members`, {
    method: "POST",
    headers: { ...JSON_HEADERS, "X-CSRF-Token": ensureCsrfToken() },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as
    | { data: OrganizationMember }
    | { title?: string; detail?: string }
    | null;
  if (!response.ok) {
    const problem = body as { title?: string; detail?: string } | null;
    throw new PilotApiError(
      problem?.detail ?? problem?.title ?? "新增成員失敗，請稍後再試。",
      response.status,
    );
  }
  return (body as { data: OrganizationMember }).data;
};

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; members: OrganizationMember[] };

interface FormState {
  displayName: string;
  email: string;
  role: InviteMemberInput["role"];
}

const emptyForm: FormState = { displayName: "", email: "", role: "technician" };

interface TeamManagementProps {
  organizationId: string;
  role: OrganizationMember["role"];
  loadMembers?: LoadMembers;
  inviteMember?: InviteMember;
}

export function TeamManagement({
  organizationId,
  role,
  loadMembers = fetchAllMembers,
  inviteMember = invitePilotMember,
}: Readonly<TeamManagementProps>) {
  const canManage = MANAGER_ROLES.has(role);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setList({ status: "loading" });
    try {
      const members = await loadMembers(organizationId);
      setList({ status: "ready", members });
    } catch {
      setList({ status: "error" });
    }
  }, [loadMembers, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateForm = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
    setAdded(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = form.displayName.trim();
    const email = form.email.trim();
    if (!displayName || !email) {
      setFormError("姓名與 Email 都需要填寫。");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setAdded(null);
    try {
      const created = await inviteMember(organizationId, {
        displayName,
        email,
        role: form.role,
      });
      setForm(emptyForm);
      setAdded(`已新增 ${created.displayName}`);
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "新增成員失敗，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PilotPage>
      <PilotBrand eyebrow="成員管理" />
      <Link
        href="/app"
        className="mb-4 inline-flex min-h-10 items-center text-sm font-bold text-orange-deep"
      >
        ← 回工作台
      </Link>
      <header className="mb-5">
        <h1 className="text-[28px] font-black tracking-[-0.04em] text-ink">成員</h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          新增技師後，排程指派選單就能選到他。
        </p>
      </header>

      {canManage ? (
        <PilotCard className="mb-5">
          <h2 className="text-base font-black text-ink">新增技師</h2>
          <form aria-label="新增成員" className="mt-3 space-y-4" onSubmit={submit}>
            <Field>
              <label htmlFor="team-name" className="mb-1.5 block text-sm font-bold text-ink-2">
                姓名
              </label>
              <PilotInput
                id="team-name"
                value={form.displayName}
                onChange={(event) => updateForm("displayName", event.target.value)}
                maxLength={80}
                autoComplete="off"
              />
            </Field>
            <Field>
              <label htmlFor="team-email" className="mb-1.5 block text-sm font-bold text-ink-2">
                Email
              </label>
              <PilotInput
                id="team-email"
                type="email"
                value={form.email}
                onChange={(event) => updateForm("email", event.target.value)}
                maxLength={200}
                autoComplete="off"
              />
            </Field>
            <Field>
              <label htmlFor="team-role" className="mb-1.5 block text-sm font-bold text-ink-2">
                角色
              </label>
              <PilotSelect
                id="team-role"
                value={form.role}
                onChange={(event) =>
                  updateForm("role", event.target.value as InviteMemberInput["role"])
                }
              >
                {INVITABLE_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </PilotSelect>
            </Field>

            {formError ? <PilotInlineNotice>{formError}</PilotInlineNotice> : null}
            {added ? (
              <div role="status" aria-label="新增結果">
                <PilotInlineNotice tone="success">{added}</PilotInlineNotice>
              </div>
            ) : null}

            <PilotButton type="submit" className="w-full" disabled={submitting}>
              {submitting ? "正在新增…" : "新增技師"}
            </PilotButton>
          </form>
        </PilotCard>
      ) : (
        <div className="mb-5">
          <PilotInlineNotice tone="info">
            你沒有成員管理權限，只能查看團隊名單。新增技師請聯絡負責人或管理員。
          </PilotInlineNotice>
        </div>
      )}

      {list.status === "loading" ? <PilotLoading label="正在載入成員" /> : null}

      {list.status === "error" ? (
        <PilotError
          title="成員名單暫時讀不到"
          description="既有成員沒有被修改。請確認網路後重新載入。"
          actionLabel="重新載入"
          onRetry={() => void load()}
        />
      ) : null}

      {list.status === "ready" && list.members.length === 0 ? (
        <PilotCard className="py-10 text-center">
          <h2 className="text-lg font-black text-ink">還沒有其他成員</h2>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            {canManage
              ? "用上方表單新增你的第一位技師。"
              : "團隊名單會在負責人新增成員後出現在這裡。"}
          </p>
        </PilotCard>
      ) : null}

      {list.status === "ready" && list.members.length > 0 ? (
        <ul aria-label="成員清單" className="space-y-3">
          {list.members.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-[18px] border border-warm-border bg-white p-4 shadow-sm"
            >
              <div className="min-w-0">
                <p className="truncate text-base font-black text-ink">{entry.displayName}</p>
                <p className="mt-0.5 text-xs font-bold text-ink-3">
                  {ROLE_LABELS[entry.role] ?? entry.role}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_TONES[entry.status]}`}
              >
                {STATUS_LABELS[entry.status] ?? entry.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </PilotPage>
  );
}

type ScreenState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "no-org" }
  | { status: "ready"; organizationId: string; role: OrganizationMember["role"] };

/**
 * Route-level wrapper: resolves the active membership (org + role) from the
 * session, then renders the pure {@link TeamManagement}. Kept out of the pure
 * component so unit tests can drive org/role directly without stubbing session.
 */
export function TeamManagementScreen() {
  const [state, setState] = useState<ScreenState>({ status: "loading" });
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
          setState({ status: "no-org" });
          return;
        }
        setState({
          status: "ready",
          organizationId: membership.organizationId,
          role: membership.role as OrganizationMember["role"],
        });
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
        <PilotBrand eyebrow="成員管理" />
        <PilotLoading label="正在載入成員" />
      </PilotPage>
    );
  }

  if (state.status === "error") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="成員管理" />
        <PilotError
          title="成員名單暫時讀不到"
          description="既有成員沒有被修改。請確認網路後重新載入。"
          actionLabel="重新載入"
          onRetry={() => setAttempt((current) => current + 1)}
        />
      </PilotPage>
    );
  }

  if (state.status === "no-org") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="成員管理" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">尚未建立工作空間</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            先完成店家建立，才能開始新增團隊成員。
          </p>
          <Link
            href="/app/onboarding"
            className="mt-4 inline-flex min-h-11 items-center text-sm font-bold text-orange"
          >
            前往建立店家
          </Link>
        </PilotCard>
      </PilotPage>
    );
  }

  return <TeamManagement organizationId={state.organizationId} role={state.role} />;
}
