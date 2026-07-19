"use client";

import { useState } from "react";

import {
  createIdempotencyKey,
  createPilotOrganization,
  type IndustryTemplate,
  type PilotOrganizationCreated,
} from "./api";
import {
  Field,
  PilotBrand,
  PilotButton,
  PilotCard,
  PilotInlineNotice,
  PilotInput,
  PilotPage,
  PilotSelect,
} from "./ui";

const templateOptions: Array<{ value: IndustryTemplate; label: string }> = [
  { value: "general_field_service", label: "通用工程與到府服務" },
  { value: "cooling", label: "冷氣清洗與維修" },
  { value: "plumbing", label: "水電工程" },
  { value: "waterproofing", label: "抓漏與防水" },
  { value: "renovation", label: "小型裝修" },
];

interface OnboardingFormState {
  name: string;
  slug: string;
  ownerDisplayName: string;
  industryTemplate: IndustryTemplate;
  timezone: string;
}

const initialForm: OnboardingFormState = {
  name: "",
  slug: "",
  ownerDisplayName: "",
  industryTemplate: "general_field_service",
  timezone: "Asia/Taipei",
};

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function PilotOnboardingForm() {
  const [form, setForm] = useState(initialForm);
  const [idempotencyKey] = useState(createIdempotencyKey);
  const [result, setResult] = useState<PilotOrganizationCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const updateForm = <Key extends keyof OnboardingFormState>(
    key: Key,
    value: OnboardingFormState[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!form.name.trim() || !form.ownerDisplayName.trim()) {
      setError("請填寫店家名稱與老闆顯示名稱。");
      return;
    }
    if (!isValidSlug(form.slug)) {
      setError("網址代稱只能使用小寫英文、數字與中線。");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createPilotOrganization(
        {
          name: form.name.trim(),
          slug: form.slug,
          ownerDisplayName: form.ownerDisplayName.trim(),
          industryTemplate: form.industryTemplate,
          timezone: form.timezone,
          currency: "TWD",
        },
        idempotencyKey,
      );
      setResult(created);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "工作空間建立失敗，請稍後再試。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const copyPublicLink = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.publicIntakeUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  if (result) {
    return (
      <PilotPage>
        <PilotBrand eyebrow="初始設定" />
        <PilotCard>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--warm-green-soft)] text-2xl font-black text-[var(--warm-green)]">
            ✓
          </div>
          <h1 className="mt-5 text-2xl font-black tracking-[-0.03em] text-ink">
            工作空間建立完成
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            {result.organization.name} 已可以用公開表單收第一筆真實需求。客戶不需要註冊。
          </p>

          <div className="mt-6 rounded-2xl bg-bg-warm p-4">
            <label htmlFor="public-intake-url" className="text-xs font-bold text-ink-2">
              公開報修連結
            </label>
            <PilotInput
              id="public-intake-url"
              className="mt-2"
              value={result.publicIntakeUrl}
              readOnly
            />
            <PilotButton
              type="button"
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => void copyPublicLink()}
            >
              複製公開報修連結
            </PilotButton>
            {copyState === "copied" ? (
              <div role="status" className="mt-2 text-center text-xs font-bold text-[var(--warm-green)]">
                連結已複製
              </div>
            ) : null}
            {copyState === "error" ? (
              <div role="alert" className="mt-2 text-center text-xs font-bold text-[var(--warm-red)]">
                無法自動複製，請長按上方連結複製。
              </div>
            ) : null}
          </div>

          <a
            href="/app/inbox"
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-orange px-4 text-sm font-bold text-white shadow-[0_10px_25px_rgba(226,105,31,0.22)]"
          >
            前往接案匣
          </a>
        </PilotCard>
      </PilotPage>
    );
  }

  return (
    <PilotPage>
      <PilotBrand eyebrow="初始設定" />
      <div className="mb-5">
        <p className="text-xs font-bold text-orange-deep">5 分鐘完成</p>
        <h1 className="mt-1 text-[28px] font-black tracking-[-0.04em] text-ink">
          建立你的工作空間
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          先設定店家與服務模板，之後再邀請技師或串接 LINE 官方帳號。
        </p>
      </div>

      <PilotCard>
        <form className="space-y-5" onSubmit={submit}>
          <Field hint="客戶在報修表單上會看到這個名稱。">
            <label htmlFor="organization-name" className="mb-1.5 block text-sm font-bold text-ink-2">
              店家名稱
            </label>
            <PilotInput
              id="organization-name"
              value={form.name}
              onChange={(event) => updateForm("name", event.target.value)}
              maxLength={200}
              autoComplete="organization"
              placeholder="例：安心工程"
              required
            />
          </Field>

          <Field hint="只使用小寫英文、數字與中線，例如 anxin-service。">
            <label htmlFor="organization-slug" className="mb-1.5 block text-sm font-bold text-ink-2">
              網址代稱
            </label>
            <PilotInput
              id="organization-slug"
              value={form.slug}
              onChange={(event) => updateForm("slug", event.target.value.toLowerCase())}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              maxLength={80}
              autoCapitalize="none"
              autoComplete="off"
              placeholder="anxin-service"
              required
            />
          </Field>

          <Field>
            <label htmlFor="owner-display-name" className="mb-1.5 block text-sm font-bold text-ink-2">
              老闆顯示名稱
            </label>
            <PilotInput
              id="owner-display-name"
              value={form.ownerDisplayName}
              onChange={(event) => updateForm("ownerDisplayName", event.target.value)}
              maxLength={200}
              autoComplete="name"
              placeholder="例：王老闆"
              required
            />
          </Field>

          <Field hint="模板只是起始設定，之後可以調整服務與檢查表。">
            <label htmlFor="industry-template" className="mb-1.5 block text-sm font-bold text-ink-2">
              主要服務模板
            </label>
            <PilotSelect
              id="industry-template"
              value={form.industryTemplate}
              onChange={(event) =>
                updateForm("industryTemplate", event.target.value as IndustryTemplate)
              }
            >
              {templateOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </PilotSelect>
          </Field>

          <Field>
            <label htmlFor="timezone" className="mb-1.5 block text-sm font-bold text-ink-2">
              時區
            </label>
            <PilotSelect
              id="timezone"
              value={form.timezone}
              onChange={(event) => updateForm("timezone", event.target.value)}
            >
              <option value="Asia/Taipei">台灣（Asia/Taipei）</option>
            </PilotSelect>
          </Field>

          {error ? <PilotInlineNotice>{error}</PilotInlineNotice> : null}

          <PilotButton type="submit" className="w-full" disabled={submitting}>
            {submitting ? "正在建立…" : "建立工作空間"}
          </PilotButton>
        </form>
      </PilotCard>
    </PilotPage>
  );
}
