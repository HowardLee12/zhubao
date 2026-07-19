"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  completePublicPhotoUpload,
  createIdempotencyKey,
  createPublicPhotoUpload,
  fetchPublicIntakeConfiguration,
  sha256File,
  submitPublicIntake,
  uploadToSignedUrl,
  type PublicIntakeConfiguration,
  type PublicIntakeReceipt,
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
  PilotSelect,
  PilotTextarea,
} from "./ui";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const CLIENT_PHOTO_LIMIT = 3;

interface PublicFormState {
  contactName: string;
  contactPhone: string;
  serviceCatalogItemId: string;
  title: string;
  description: string;
  addressLine: string;
  startsAt: string;
  endsAt: string;
  privacyAccepted: boolean;
  companyWebsite: string;
}

const initialForm: PublicFormState = {
  contactName: "",
  contactPhone: "",
  serviceCatalogItemId: "",
  title: "",
  description: "",
  addressLine: "",
  startsAt: "",
  endsAt: "",
  privacyAccepted: false,
  companyWebsite: "",
};

export function normalizeTaiwanPhone(value: string): string | null {
  const normalized = value.trim().replace(/[\s().-]/g, "");
  if (/^\+[1-9][0-9]{7,14}$/.test(normalized)) return normalized;
  if (/^0[1-9][0-9]{7,9}$/.test(normalized)) return `+886${normalized.slice(1)}`;
  return null;
}

function toUtcTimestamp(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function fileCacheKey(file: File, sha256: string): string {
  return [file.name, file.type, file.size, file.lastModified, sha256].join(":");
}

export function PublicIntakeForm({ token }: { token: string }) {
  const [configuration, setConfiguration] = useState<PublicIntakeConfiguration | null>(null);
  const [configurationState, setConfigurationState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [form, setForm] = useState(initialForm);
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<PublicIntakeReceipt | null>(null);
  const [submitIdempotencyKey] = useState(createIdempotencyKey);
  const uploadedPhotos = useRef(new Map<string, string>());

  const loadConfiguration = useCallback(async () => {
    setConfigurationState("loading");
    setError(null);
    try {
      const loaded = await fetchPublicIntakeConfiguration(token);
      setConfiguration(loaded);
      setConfigurationState("ready");
      uploadedPhotos.current.clear();
    } catch {
      setConfiguration(null);
      setConfigurationState("error");
    }
  }, [token]);

  useEffect(() => {
    void loadConfiguration();
  }, [loadConfiguration]);

  const updateForm = <Key extends keyof PublicFormState>(
    key: Key,
    value: PublicFormState[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const selectPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!configuration) return;
    const selected = Array.from(event.target.files ?? []);
    const maximum = Math.min(CLIENT_PHOTO_LIMIT, configuration.photoLimit);

    if (selected.length > maximum) {
      setError(`最多只能選 ${maximum} 張照片。`);
      setPhotos([]);
      return;
    }
    if (
      selected.some(
        (file) => !configuration.acceptedPhotoTypes.some((type) => type === file.type),
      )
    ) {
      setError("只支援 JPG、PNG 或 WebP 照片。");
      setPhotos([]);
      return;
    }
    if (selected.some((file) => file.size < 1 || file.size > MAX_PHOTO_BYTES)) {
      setError("每張照片需小於 10 MB，且不可為空檔案。");
      setPhotos([]);
      return;
    }
    if (selected.some((file) => file.name.length > 200)) {
      setError("照片檔名過長，請重新命名後再上傳。");
      setPhotos([]);
      return;
    }

    uploadedPhotos.current.clear();
    setPhotos(selected);
    setError(null);
  };

  const uploadPhoto = async (
    file: File,
    index: number,
    config: PublicIntakeConfiguration,
  ): Promise<string> => {
    setProgress(`正在上傳第 ${index + 1} 張，共 ${photos.length} 張…`);
    const checksum = await sha256File(file);
    const cacheKey = fileCacheKey(file, checksum);
    const cachedPhotoId = uploadedPhotos.current.get(cacheKey);
    if (cachedPhotoId) return cachedPhotoId;

    const instruction = await createPublicPhotoUpload(
      token,
      config.submissionId,
      file,
      checksum,
    );
    await uploadToSignedUrl(instruction.upload, file);
    await completePublicPhotoUpload(
      token,
      config.submissionId,
      instruction.photoId,
      createIdempotencyKey(),
    );
    uploadedPhotos.current.set(cacheKey, instruction.photoId);
    return instruction.photoId;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!configuration) return;
    setError(null);

    const phone = normalizeTaiwanPhone(form.contactPhone);
    if (!form.contactName.trim() || !phone) {
      setError("請填寫聯絡人與有效手機號碼，例如 0912 345 678。");
      return;
    }
    if (
      !configuration.serviceCatalogItems.some(
        (item) => item.id === form.serviceCatalogItemId,
      )
    ) {
      setError("請選擇需要的服務項目。");
      return;
    }
    if (!form.title.trim() || !form.description.trim() || !form.addressLine.trim()) {
      setError("請填寫需求標題、問題說明與服務地址。");
      return;
    }
    if (!form.privacyAccepted) {
      setError("請先同意個資蒐集說明再送出。");
      return;
    }

    const startsAt = toUtcTimestamp(form.startsAt);
    const endsAt = toUtcTimestamp(form.endsAt);
    if ((startsAt && !endsAt) || (!startsAt && endsAt)) {
      setError("希望時段需要同時填寫開始與結束時間。");
      return;
    }
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      setError("希望結束時間必須晚於開始時間。");
      return;
    }

    setSubmitting(true);
    try {
      const photoIds: string[] = [];
      for (let index = 0; index < photos.length; index += 1) {
        photoIds.push(await uploadPhoto(photos[index], index, configuration));
      }

      setProgress("正在送出需求…");
      const accepted = await submitPublicIntake(
        token,
        {
          submissionId: configuration.submissionId,
          contactName: form.contactName.trim(),
          contactPhone: phone,
          serviceCatalogItemId: form.serviceCatalogItemId,
          title: form.title.trim(),
          description: form.description.trim(),
          address: { addressLine: form.addressLine.trim() },
          preferredWindows:
            startsAt && endsAt
              ? [{ startsAt, endsAt, preferenceRank: 1 }]
              : [],
          photoIds,
          privacyAccepted: true,
          companyWebsite: form.companyWebsite,
        },
        submitIdempotencyKey,
      );
      setReceipt(accepted);
      setProgress(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "需求送出失敗，請稍後再試。");
      setProgress(null);
    } finally {
      setSubmitting(false);
    }
  };

  if (configurationState === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="公開報修" />
        <PilotLoading label="正在載入報修表單" />
      </PilotPage>
    );
  }

  if (configurationState === "error" || !configuration) {
    return (
      <PilotPage>
        <PilotBrand eyebrow="公開報修" />
        <PilotError
          title="這份報修表單目前無法開啟"
          description="連結可能已過期或店家暫停收件。你可以重新載入，或直接聯絡店家。"
          actionLabel="重新載入"
          onRetry={() => void loadConfiguration()}
        />
      </PilotPage>
    );
  }

  if (receipt) {
    return (
      <PilotPage>
        <PilotBrand eyebrow="公開報修" />
        <PilotCard className="py-9 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-[var(--warm-green-soft)] text-3xl font-black text-[var(--warm-green)]">
            ✓
          </div>
          <h1 className="mt-5 text-2xl font-black tracking-[-0.03em] text-ink">需求已送出</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">{receipt.message}</p>
          <div className="mt-6 rounded-2xl bg-bg-warm px-4 py-4">
            <p className="text-xs font-semibold text-ink-3">案件參考編號</p>
            <p className="mt-1 font-mono text-lg font-black text-orange-deep">
              {receipt.referenceNo}
            </p>
          </div>
          <p className="mt-5 text-xs leading-5 text-ink-3">
            請保留參考編號。若需要補充資料，可直接回到 LINE 與店家聯絡。
          </p>
        </PilotCard>
      </PilotPage>
    );
  }

  const maximumPhotos = Math.min(CLIENT_PHOTO_LIMIT, configuration.photoLimit);

  return (
    <PilotPage>
      <PilotBrand eyebrow="公開報修" />
      <header className="mb-5">
        <p className="text-xs font-bold text-orange-deep">{configuration.merchantName}</p>
        <h1 className="mt-1 text-[28px] font-black tracking-[-0.04em] text-ink">
          {configuration.headline}
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          不用註冊帳號，送出後店家會直接與你聯絡。
        </p>
      </header>

      <PilotCard>
        <form aria-label="報修需求" className="space-y-5" onSubmit={submit}>
          <Field>
            <label htmlFor="contact-name" className="mb-1.5 block text-sm font-bold text-ink-2">
              聯絡人姓名
            </label>
            <PilotInput
              id="contact-name"
              value={form.contactName}
              onChange={(event) => updateForm("contactName", event.target.value)}
              autoComplete="name"
              maxLength={120}
              required
            />
          </Field>

          <Field hint="可填 0912 345 678，系統會轉成國際格式保存。">
            <label htmlFor="contact-phone" className="mb-1.5 block text-sm font-bold text-ink-2">
              手機號碼
            </label>
            <PilotInput
              id="contact-phone"
              type="tel"
              inputMode="tel"
              value={form.contactPhone}
              onChange={(event) => updateForm("contactPhone", event.target.value)}
              autoComplete="tel"
              maxLength={24}
              placeholder="0912 345 678"
              required
            />
          </Field>

          <Field>
            <label htmlFor="service-item" className="mb-1.5 block text-sm font-bold text-ink-2">
              服務項目
            </label>
            <PilotSelect
              id="service-item"
              value={form.serviceCatalogItemId}
              onChange={(event) => updateForm("serviceCatalogItemId", event.target.value)}
              required
            >
              <option value="">請選擇</option>
              {configuration.serviceCatalogItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.category}・{item.name}
                </option>
              ))}
            </PilotSelect>
          </Field>

          <Field>
            <label htmlFor="request-title" className="mb-1.5 block text-sm font-bold text-ink-2">
              需求標題
            </label>
            <PilotInput
              id="request-title"
              value={form.title}
              onChange={(event) => updateForm("title", event.target.value)}
              maxLength={160}
              placeholder="例：客廳冷氣有異味"
              required
            />
          </Field>

          <Field hint="請描述數量、問題與希望怎麼處理；店家仍會人工確認。">
            <label htmlFor="request-description" className="mb-1.5 block text-sm font-bold text-ink-2">
              問題與需求說明
            </label>
            <PilotTextarea
              id="request-description"
              value={form.description}
              onChange={(event) => updateForm("description", event.target.value)}
              maxLength={10_000}
              required
            />
          </Field>

          <Field>
            <label htmlFor="service-address" className="mb-1.5 block text-sm font-bold text-ink-2">
              服務地址
            </label>
            <PilotInput
              id="service-address"
              value={form.addressLine}
              onChange={(event) => updateForm("addressLine", event.target.value)}
              autoComplete="street-address"
              maxLength={300}
              placeholder="縣市、區、路名與樓層"
              required
            />
          </Field>

          <fieldset className="rounded-2xl border border-warm-border bg-surface-warm p-4">
            <legend className="px-1 text-sm font-bold text-ink-2">希望到場時段（選填）</legend>
            <div className="mt-2 space-y-4">
              <Field>
                <label htmlFor="preferred-start" className="mb-1.5 block text-xs font-bold text-ink-3">
                  希望開始時間（選填）
                </label>
                <PilotInput
                  id="preferred-start"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) => updateForm("startsAt", event.target.value)}
                />
              </Field>
              <Field>
                <label htmlFor="preferred-end" className="mb-1.5 block text-xs font-bold text-ink-3">
                  希望結束時間（選填）
                </label>
                <PilotInput
                  id="preferred-end"
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(event) => updateForm("endsAt", event.target.value)}
                />
              </Field>
            </div>
          </fieldset>

          {maximumPhotos > 0 ? (
            <Field hint={`可選 ${maximumPhotos} 張，每張最多 10 MB。`}>
              <label htmlFor="intake-photos" className="mb-1.5 block text-sm font-bold text-ink-2">
                現況照片（最多 {maximumPhotos} 張，選填）
              </label>
              <input
                id="intake-photos"
                type="file"
                accept={configuration.acceptedPhotoTypes.join(",")}
                multiple
                onChange={selectPhotos}
                className="block w-full rounded-xl border border-dashed border-warm-border-strong bg-bg-warm px-3 py-4 text-sm text-ink-2 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-soft file:px-3 file:py-2 file:text-xs file:font-bold file:text-orange-deep"
              />
              {photos.length > 0 ? (
                <ul className="mt-3 space-y-1.5" aria-label="已選照片">
                  {photos.map((photo) => (
                    <li key={`${photo.name}-${photo.lastModified}`} className="truncate text-xs text-ink-2">
                      {photo.name}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Field>
          ) : null}

          <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
            <label htmlFor="company-website">公司網站（請留空）</label>
            <input
              id="company-website"
              name="companyWebsite"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={form.companyWebsite}
              onChange={(event) => updateForm("companyWebsite", event.target.value)}
            />
          </div>

          <div className="rounded-2xl bg-bg-warm p-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-ink-2">
              <input
                type="checkbox"
                checked={form.privacyAccepted}
                onChange={(event) => updateForm("privacyAccepted", event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-orange"
              />
              <span>
                <span className="font-bold">我已閱讀並同意個資蒐集說明</span>
                <span className="mt-1 block text-xs leading-5 text-ink-3">
                  {configuration.privacyNotice}
                </span>
              </span>
            </label>
          </div>

          {error ? <PilotInlineNotice>{error}</PilotInlineNotice> : null}
          {progress ? <PilotInlineNotice tone="info">{progress}</PilotInlineNotice> : null}

          <PilotButton type="submit" className="w-full" disabled={submitting}>
            {submitting ? "正在處理…" : "送出需求"}
          </PilotButton>
          <p className="text-center text-[11px] leading-5 text-ink-3">
            送出不代表報價或預約成立，店家確認後才會與你聯絡。
          </p>
        </form>
      </PilotCard>
    </PilotPage>
  );
}
