"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  createIdempotencyKey,
  fetchPilotOrganizationSettings,
  fetchPilotSession,
  rotatePilotPublicIntakeLink,
  updatePilotOrganizationSettings,
  type PilotOrganizationSettings,
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

interface SettingsFormState {
  name: string;
  intakeHeadline: string;
  privacyNotice: string;
}

const emptyForm: SettingsFormState = {
  name: "",
  intakeHeadline: "",
  privacyNotice: "",
};

function formFromSettings(settings: PilotOrganizationSettings): SettingsFormState {
  return {
    name: settings.name,
    intakeHeadline: settings.intakeHeadline,
    privacyNotice: settings.privacyNotice,
  };
}

export function PilotSettings() {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [settings, setSettings] = useState<PilotOrganizationSettings | null>(null);
  const [form, setForm] = useState<SettingsFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [rotateState, setRotateState] = useState<"idle" | "confirming" | "rotating">("idle");
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [newPublicUrl, setNewPublicUrl] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [rotateIdempotencyKey] = useState(createIdempotencyKey);

  useEffect(() => {
    let active = true;

    void fetchPilotSession()
      .then((session) => {
        const membership = session.memberships.find((candidate) => candidate.status === "active");
        if (!membership) throw new Error("尚未建立工作空間");
        return Promise.all([
          membership.organizationId,
          fetchPilotOrganizationSettings(membership.organizationId),
        ] as const);
      })
      .then(([activeOrganizationId, loaded]) => {
        if (!active) return;
        setOrganizationId(activeOrganizationId);
        setSettings(loaded);
        setForm(formFromSettings(loaded));
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = () => {
    setLoadState("loading");
    setAttempt((current) => current + 1);
  };

  const updateForm = <Key extends keyof SettingsFormState>(
    key: Key,
    value: SettingsFormState[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveError(null);
    setSaved(false);
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId || !settings) return;

    const name = form.name.trim();
    const intakeHeadline = form.intakeHeadline.trim();
    const privacyNotice = form.privacyNotice.trim();
    if (!name || !intakeHeadline || !privacyNotice) {
      setSaveError("店家名稱、公開表單標題與個資說明都需要填寫。");
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await updatePilotOrganizationSettings(organizationId, {
        name,
        intakeHeadline,
        privacyNotice,
        lockVersion: settings.lockVersion,
      });
      setSettings(updated);
      setForm(formFromSettings(updated));
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "設定儲存失敗，請稍後再試。");
    } finally {
      setSaving(false);
    }
  };

  const rotateLink = async () => {
    if (!organizationId) return;
    setRotateState("rotating");
    setRotateError(null);
    try {
      const publicUrl = await rotatePilotPublicIntakeLink(
        organizationId,
        rotateIdempotencyKey,
      );
      setNewPublicUrl(publicUrl);
      setRotateState("idle");
    } catch (cause) {
      setRotateError(
        cause instanceof Error ? cause.message : "新連結產生失敗，舊連結尚未變更。",
      );
      setRotateState("idle");
    }
  };

  const copyNewLink = async () => {
    if (!newPublicUrl) return;
    try {
      await navigator.clipboard.writeText(newPublicUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  if (loadState === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="店家設定" />
        <PilotLoading label="正在載入店家設定" />
      </PilotPage>
    );
  }

  if (loadState === "error" || !settings) {
    return (
      <PilotPage>
        <PilotBrand eyebrow="店家設定" />
        <PilotError
          title="店家設定暫時讀不到"
          description="既有設定沒有被修改。請確認網路後重新載入。"
          actionLabel="重新載入"
          onRetry={retry}
        />
      </PilotPage>
    );
  }

  return (
    <PilotPage>
      <PilotBrand eyebrow="店家設定" />
      <Link href="/app/inbox" className="mb-4 inline-flex min-h-10 items-center text-sm font-bold text-orange-deep">
        ← 回接案匣
      </Link>
      <header className="mb-5">
        <h1 className="text-[28px] font-black tracking-[-0.04em] text-ink">店家與公開表單</h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          這些內容會出現在客戶免註冊的需求表單上。
        </p>
      </header>

      <PilotCard>
        <form aria-label="店家設定" className="space-y-5" onSubmit={save}>
          <Field>
            <label htmlFor="settings-name" className="mb-1.5 block text-sm font-bold text-ink-2">
              店家名稱
            </label>
            <PilotInput
              id="settings-name"
              value={form.name}
              onChange={(event) => updateForm("name", event.target.value)}
              maxLength={120}
              required
            />
          </Field>

          <Field hint="客戶打開報修連結時看到的主標題。">
            <label htmlFor="settings-headline" className="mb-1.5 block text-sm font-bold text-ink-2">
              公開表單標題
            </label>
            <PilotInput
              id="settings-headline"
              value={form.intakeHeadline}
              onChange={(event) => updateForm("intakeHeadline", event.target.value)}
              maxLength={160}
              required
            />
          </Field>

          <Field hint="請清楚說明蒐集目的；客戶送出前必須同意。">
            <label htmlFor="settings-privacy" className="mb-1.5 block text-sm font-bold text-ink-2">
              個資蒐集說明
            </label>
            <PilotTextarea
              id="settings-privacy"
              value={form.privacyNotice}
              onChange={(event) => updateForm("privacyNotice", event.target.value)}
              maxLength={2_000}
              required
            />
          </Field>

          {saveError ? <PilotInlineNotice>{saveError}</PilotInlineNotice> : null}
          {saved ? <PilotInlineNotice tone="success">設定已儲存</PilotInlineNotice> : null}

          <PilotButton type="submit" className="w-full" disabled={saving}>
            {saving ? "正在儲存…" : "儲存設定"}
          </PilotButton>
        </form>
      </PilotCard>

      <PilotCard className="mt-5 border-[var(--warm-red)]/20">
        <p className="text-xs font-bold text-[var(--warm-red)]">危險操作</p>
        <h2 className="mt-1 text-lg font-black text-ink">公開報修連結</h2>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          只有連結外流或需要立即停用時才重新產生。完成後舊連結無法復原。
        </p>

        {newPublicUrl ? (
          <div className="mt-4 space-y-3">
            <div role="alert" className="rounded-xl border border-[var(--warm-red)]/20 bg-[var(--warm-red-soft)] p-3 text-sm font-bold text-[var(--warm-red)]">
              舊連結已失效。這個新連結只會在本次畫面顯示，請現在複製並更新 LINE。
            </div>
            <label htmlFor="new-public-url" className="block text-xs font-bold text-ink-2">
              新公開報修連結
            </label>
            <PilotInput id="new-public-url" value={newPublicUrl} readOnly />
            <PilotButton type="button" variant="secondary" className="w-full" onClick={() => void copyNewLink()}>
              複製新連結
            </PilotButton>
            {copyState === "copied" ? (
              <p role="status" aria-label="複製結果" className="text-center text-xs font-bold text-[var(--warm-green)]">
                新連結已複製
              </p>
            ) : null}
            {copyState === "error" ? (
              <p role="alert" className="text-center text-xs font-bold text-[var(--warm-red)]">
                無法自動複製，請長按上方連結複製。
              </p>
            ) : null}
          </div>
        ) : (
          <PilotButton
            type="button"
            variant="danger"
            className="mt-4 w-full"
            onClick={() => setRotateState("confirming")}
          >
            重新產生公開報修連結
          </PilotButton>
        )}

        {rotateError ? <div className="mt-3"><PilotInlineNotice>{rotateError}</PilotInlineNotice></div> : null}
      </PilotCard>

      {rotateState === "confirming" || rotateState === "rotating" ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-4 sm:items-center sm:justify-center">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="rotate-link-title"
            aria-describedby="rotate-link-description"
            className="w-full max-w-sm rounded-[24px] bg-white p-5 shadow-2xl"
          >
            <h2 id="rotate-link-title" className="text-xl font-black text-ink">
              讓舊報修連結失效？
            </h2>
            <p id="rotate-link-description" className="mt-2 text-sm leading-6 text-ink-3">
              LINE 圖文選單或先前傳給客戶的舊連結會立即失效，且無法復原。你必須把新連結重新貼到 LINE。
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <PilotButton
                type="button"
                variant="secondary"
                disabled={rotateState === "rotating"}
                onClick={() => setRotateState("idle")}
              >
                取消
              </PilotButton>
              <PilotButton
                type="button"
                variant="danger"
                autoFocus
                disabled={rotateState === "rotating"}
                onClick={() => void rotateLink()}
              >
                {rotateState === "rotating" ? "正在產生…" : "確認使舊連結失效"}
              </PilotButton>
            </div>
          </div>
        </div>
      ) : null}
    </PilotPage>
  );
}
