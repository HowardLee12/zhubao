"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchPilotSession, type PilotMembership } from "./api";
import {
  connectLineChannel,
  disableLineChannel,
  fetchLineChannels,
  type LineChannelView,
} from "./line-notifications-api";
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
import { OWNER_ROLES } from "./work-order-format";

type LoadState = "loading" | "ready" | "error" | "restricted";

interface FormState {
  name: string;
  channelId: string;
  basicId: string;
  channelSecret: string;
  accessToken: string;
}

const emptyForm: FormState = {
  name: "",
  channelId: "",
  basicId: "",
  channelSecret: "",
  accessToken: "",
};

export function LineChannelSettings() {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [channel, setChannel] = useState<LineChannelView | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    void fetchPilotSession()
      .then(async (session) => {
        const membership: PilotMembership | undefined = session.memberships.find(
          (m) => m.status === "active",
        );
        if (!membership) throw new Error("尚未建立工作空間");
        if (!OWNER_ROLES.has(membership.role)) {
          if (active) setLoadState("restricted");
          return;
        }
        const channels = await fetchLineChannels(membership.organizationId);
        if (!active) return;
        setOrganizationId(membership.organizationId);
        // A channel is only meaningfully "connected" when it has credentials and
        // is not disabled; otherwise the honest state is 未連接.
        const connected = channels.find((c) => c.credentialConfigured && c.status === "active");
        setChannel(connected ?? null);
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const update = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
    setSaved(false);
  };

  const connect = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId) return;
    const name = form.name.trim();
    const channelId = form.channelId.trim();
    const channelSecret = form.channelSecret.trim();
    const accessToken = form.accessToken.trim();
    if (!name || !channelId || !channelSecret || !accessToken) {
      setError("名稱、Channel ID、Channel secret 與 access token 都需要填寫。");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await connectLineChannel(organizationId, {
        name,
        channelId,
        basicId: form.basicId.trim() || null,
        channelSecret,
        accessToken,
      });
      const channels = await fetchLineChannels(organizationId);
      setChannel(channels.find((c) => c.id === result.id) ?? null);
      setForm(emptyForm);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "連接失敗，請稍後再試。");
    } finally {
      setSaving(false);
    }
  };

  const disable = async () => {
    if (!organizationId || !channel) return;
    setSaving(true);
    setError(null);
    try {
      await disableLineChannel(organizationId, channel.id, "手動停用");
      const channels = await fetchLineChannels(organizationId);
      setChannel(channels.find((c) => c.credentialConfigured && c.status === "active") ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "停用失敗，請稍後再試。");
    } finally {
      setSaving(false);
    }
  };

  if (loadState === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="LINE 官方帳號" />
        <PilotLoading label="正在載入 LINE 連接狀態" />
      </PilotPage>
    );
  }

  if (loadState === "restricted") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="LINE 官方帳號" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-lg font-black text-ink">你沒有管理權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            只有負責人或管理員可以連接或停用 LINE 官方帳號。
          </p>
        </PilotCard>
      </PilotPage>
    );
  }

  if (loadState === "error") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="LINE 官方帳號" />
        <PilotError
          title="LINE 連接狀態讀不到"
          description="既有設定沒有被修改。請確認網路後重新載入。"
          actionLabel="重新載入"
          onRetry={() => setAttempt((c) => c + 1)}
        />
      </PilotPage>
    );
  }

  return (
    <PilotPage>
      <PilotBrand eyebrow="LINE 官方帳號" />
      <Link href="/app/settings" className="mb-4 inline-flex min-h-10 items-center text-sm font-bold text-orange-deep">
        ← 回店家設定
      </Link>
      <header className="mb-5">
        <h1 className="text-[28px] font-black tracking-[-0.04em] text-ink">LINE 官方帳號連接</h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          連接後，系統會在受理、報價送出、預約與完工時，自動排入 LINE 通知給客戶。
        </p>
      </header>

      <PilotCard>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-ink-2">目前狀態</p>
            {channel ? (
              <p role="status" className="mt-1 text-lg font-black text-[var(--warm-green)]">
                已連接
              </p>
            ) : (
              <p role="status" className="mt-1 text-lg font-black text-[var(--warm-red)]">
                LINE 未連接
              </p>
            )}
          </div>
          {channel ? (
            <span className="rounded-full bg-orange-soft px-3 py-1 text-xs font-bold text-orange-deep">
              {channel.name}
            </span>
          ) : null}
        </div>
        {channel ? (
          <dl className="mt-4 space-y-1 text-sm text-ink-3">
            <div className="flex justify-between gap-3">
              <dt>Channel ID</dt>
              <dd className="font-mono text-ink-2">{channel.channelId}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Webhook 已驗證</dt>
              <dd className="text-ink-2">{channel.webhookVerifiedAt ? "是" : "尚未"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>最後收到 Webhook</dt>
              <dd className="text-ink-2">{channel.lastWebhookAt ?? "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-sm leading-6 text-ink-3">
            尚未連接 LINE。現在流程仍可運作，但不會自動發送 LINE 通知給客戶。
          </p>
        )}

        {channel ? (
          <PilotButton
            type="button"
            variant="danger"
            className="mt-4 w-full"
            disabled={saving}
            onClick={() => void disable()}
          >
            停用 LINE 連接（暫停所有外發）
          </PilotButton>
        ) : null}
      </PilotCard>

      <PilotCard className="mt-5">
        <h2 className="text-lg font-black text-ink">
          {channel ? "更新連接資訊" : "連接 LINE 官方帳號"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          從 LINE Developers 主控台複製 Channel ID、Channel secret 與長期 access token。
          憑證只會在伺服器端加密保存，不會回傳到瀏覽器。
        </p>
        <form aria-label="連接 LINE 官方帳號" className="mt-4 space-y-4" onSubmit={connect}>
          <Field label="顯示名稱">
            <PilotInput
              aria-label="顯示名稱"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <Field label="Channel ID">
            <PilotInput
              aria-label="Channel ID"
              value={form.channelId}
              onChange={(e) => update("channelId", e.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <Field label="Basic ID（選填）" hint="例如 @your-oa">
            <PilotInput
              aria-label="Basic ID"
              value={form.basicId}
              onChange={(e) => update("basicId", e.target.value)}
              maxLength={120}
            />
          </Field>
          <Field label="Channel secret">
            <PilotInput
              aria-label="Channel secret"
              type="password"
              value={form.channelSecret}
              onChange={(e) => update("channelSecret", e.target.value)}
              maxLength={200}
              required
            />
          </Field>
          <Field label="長期 access token">
            <PilotInput
              aria-label="長期 access token"
              type="password"
              value={form.accessToken}
              onChange={(e) => update("accessToken", e.target.value)}
              maxLength={4096}
              required
            />
          </Field>

          {error ? <PilotInlineNotice>{error}</PilotInlineNotice> : null}
          {saved ? <PilotInlineNotice tone="success">LINE 已連接</PilotInlineNotice> : null}

          <PilotButton type="submit" className="w-full" disabled={saving}>
            {saving ? "正在連接…" : channel ? "更新連接" : "連接 LINE"}
          </PilotButton>
        </form>
      </PilotCard>
    </PilotPage>
  );
}
