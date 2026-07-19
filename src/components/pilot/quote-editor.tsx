"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { QuoteDraftInput, QuoteWorkspace } from "@/schemas/quote";
import { calculateQuoteTotals } from "@/server/domain/quotes/quote-calculation";

import { PilotApiError } from "./api";
import {
  cloneRejectedQuote,
  createQuote,
  rotateQuotePublicLink,
  saveQuoteDraft,
  sendQuote,
} from "./quote-api";
import type { ServiceRequestDetail } from "./triage-api";
import {
  Field,
  PilotBrand,
  PilotButton,
  PilotCard,
  PilotInlineNotice,
  PilotInput,
  PilotPage,
  PilotSelect,
  PilotTextarea,
} from "./ui";

type StaffRole = "owner" | "admin" | "dispatcher";
type QuoteLine = QuoteDraftInput["items"][number] & { clientId: string };
type QuoteEditorDraft = Omit<QuoteDraftInput, "items"> & { items: QuoteLine[] };

const statusLabels: Record<QuoteWorkspace["quote"]["status"], string> = {
  draft: "草稿",
  sent: "等待客戶",
  viewed: "客戶已開啟",
  accepted: "客戶已接受",
  rejected: "客戶已拒絕",
  expired: "已過期",
  cancelled: "已撤回",
};

function clientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function defaultValidUntil(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

function fromRequest(request: ServiceRequestDetail): QuoteEditorDraft {
  return {
    title: `${request.subject}報價`,
    validUntil: defaultValidUntil(),
    customerNotes: "現場若發現未包含於本報價的狀況，將另行說明並取得確認。",
    internalNotes: "",
    terms: "完工確認後付款；實際服務範圍以本報價列項為準。",
    items: [
      {
        clientId: clientId(),
        serviceCatalogItemId: null,
        groupName: "服務項目",
        name: request.subject,
        specification: request.description,
        unit: "式",
        quantity: "1.000",
        unitCostMinor: "0",
        unitPriceMinor: "0",
        discountMinor: "0",
        taxRate: "0.0000",
        sortOrder: 10,
      },
    ],
  };
}

function fromWorkspace(workspace: QuoteWorkspace): QuoteEditorDraft {
  return {
    title: workspace.version.title,
    validUntil: workspace.version.validUntil,
    customerNotes: workspace.version.customerNotes,
    internalNotes: workspace.version.internalNotes,
    terms: workspace.version.terms,
    items: workspace.version.items.map((item) => ({
      clientId: item.id,
      serviceCatalogItemId: item.serviceCatalogItemId,
      groupName: item.groupName,
      name: item.name,
      specification: item.specification,
      unit: item.unit,
      quantity: item.quantity,
      unitCostMinor: item.unitCostMinor,
      unitPriceMinor: item.unitPriceMinor,
      discountMinor: item.discountMinor,
      taxRate: item.taxRate,
      sortOrder: item.sortOrder,
    })),
  };
}

function money(value: string): string {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return `NT$${value}`;
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function persistedWorkspace(result: QuoteWorkspace & { publicQuoteUrl?: string }): QuoteWorkspace {
  const workspace = { ...result };
  delete workspace.publicQuoteUrl;
  return workspace;
}

export function PilotQuoteEditor({
  organizationId,
  role,
  request,
  initialWorkspace = null,
}: Readonly<{
  organizationId: string;
  role: StaffRole;
  request: ServiceRequestDetail | null;
  initialWorkspace?: QuoteWorkspace | null;
}>) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<QuoteWorkspace | null>(initialWorkspace);
  const [draft, setDraft] = useState<QuoteEditorDraft>(() =>
    initialWorkspace ? fromWorkspace(initialWorkspace) : fromRequest(request!),
  );
  const [view, setView] = useState<"internal" | "customer">("internal");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "send" | "clone" | "rotate" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);

  const totals = useMemo(() => {
    try {
      return calculateQuoteTotals(draft.items);
    } catch {
      return null;
    }
  }, [draft.items]);

  const editable = !workspace || workspace.version.status === "draft";
  const canSend = role === "owner" || role === "admin";
  const requestId = workspace?.request.id ?? request?.id;
  const requestLockVersion = workspace?.request.lockVersion ?? request?.lockVersion;

  function updateDraft<K extends Exclude<keyof QuoteDraftInput, "items">>(
    field: K,
    value: QuoteDraftInput[K],
  ) {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setConfirmed(false);
  }

  function updateLine(index: number, field: keyof QuoteLine, value: string) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line,
      ),
    }));
    setDirty(true);
    setConfirmed(false);
  }

  function addLine() {
    setDraft((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          clientId: clientId(),
          serviceCatalogItemId: null,
          groupName: "服務項目",
          name: "",
          specification: "",
          unit: "式",
          quantity: "1.000",
          unitCostMinor: "0",
          unitPriceMinor: "0",
          discountMinor: "0",
          taxRate: "0.0000",
          sortOrder: (current.items.length + 1) * 10,
        },
      ],
    }));
    setDirty(true);
  }

  function removeLine(index: number) {
    setDraft((current) => ({
      ...current,
      items: current.items
        .filter((_, lineIndex) => lineIndex !== index)
        .map((line, lineIndex) => ({ ...line, sortOrder: (lineIndex + 1) * 10 })),
    }));
    setDirty(true);
  }

  function apiDraft(): QuoteDraftInput {
    return {
      title: draft.title,
      validUntil: draft.validUntil || null,
      customerNotes: draft.customerNotes,
      internalNotes: draft.internalNotes,
      terms: draft.terms,
      items: draft.items.map((line, index) => ({
        serviceCatalogItemId: line.serviceCatalogItemId,
        groupName: line.groupName,
        name: line.name,
        specification: line.specification,
        unit: line.unit,
        quantity: line.quantity,
        unitCostMinor: line.unitCostMinor,
        unitPriceMinor: line.unitPriceMinor,
        discountMinor: line.discountMinor,
        taxRate: line.taxRate,
        sortOrder: (index + 1) * 10,
      })),
    };
  }

  async function save() {
    if (!requestId || !requestLockVersion || !totals || draft.items.length === 0) {
      setNotice({ tone: "error", text: "請先修正品項、數量、金額與客戶資料。" });
      return;
    }
    setBusy("save");
    setNotice(null);
    try {
      const result = workspace
        ? await saveQuoteDraft(
            organizationId,
            workspace.version.id,
            workspace.quote.lockVersion,
            apiDraft(),
          )
        : await createQuote(
            organizationId,
            requestLockVersion,
            globalThis.crypto.randomUUID(),
            {
              serviceRequestId: requestId,
              customerId: request!.customerId!,
              locationId: request!.locationId!,
              currency: "TWD",
              version: apiDraft(),
            },
          );
      setWorkspace(result);
      setDraft(fromWorkspace(result));
      setDirty(false);
      setConfirmed(false);
      setNotice({ tone: "success", text: "報價草稿已儲存，重新整理也不會消失。" });
      if (!workspace) router.replace(`/app/quotes/${result.quote.id}`);
    } catch (error) {
      setNotice({
        tone: "error",
        text:
          error instanceof PilotApiError && error.status === 412
            ? "報價已被其他人更新，請重新整理後再編輯。"
            : error instanceof Error
              ? error.message
              : "草稿儲存失敗，請稍後再試。",
      });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!workspace || dirty || !confirmed) return;
    setBusy("send");
    setNotice(null);
    try {
      const result = await sendQuote(organizationId, workspace, globalThis.crypto.randomUUID());
      setWorkspace(persistedWorkspace(result));
      setPublicUrl(result.publicQuoteUrl);
      setConfirmed(false);
      setNotice({ tone: "success", text: "報價已鎖定送出；請複製安全連結傳給客戶。" });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "報價送出失敗，請稍後再試。",
      });
    } finally {
      setBusy(null);
    }
  }

  async function rotateLink() {
    if (!workspace) return;
    setBusy("rotate");
    setNotice(null);
    try {
      const result = await rotateQuotePublicLink(
        organizationId,
        workspace,
        globalThis.crypto.randomUUID(),
      );
      setWorkspace(persistedWorkspace(result));
      setPublicUrl(result.publicQuoteUrl);
      setRotateConfirm(false);
      setNotice({ tone: "success", text: "新連結已建立；先前的分享連結已失效。" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "連結建立失敗。" });
    } finally {
      setBusy(null);
    }
  }

  async function cloneRevision() {
    if (!workspace) return;
    setBusy("clone");
    setNotice(null);
    try {
      const result = await cloneRejectedQuote(
        organizationId,
        workspace,
        globalThis.crypto.randomUUID(),
      );
      setWorkspace(result);
      setDraft(fromWorkspace(result));
      setDirty(false);
      setPublicUrl(null);
      setNotice({ tone: "success", text: `已從 v${workspace.version.versionNo} 建立 v${result.version.versionNo} 草稿；舊版仍完整保留。` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "建立新版失敗。" });
    } finally {
      setBusy(null);
    }
  }

  async function copyPublicUrl() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setNotice({ tone: "success", text: "客戶報價連結已複製。" });
    } catch {
      setNotice({ tone: "info", text: "無法自動複製，請長按連結手動複製。" });
    }
  }

  return (
    <PilotPage>
      <PilotBrand eyebrow="真實報價" />
      <Link
        href={requestId ? `/app/inbox/${requestId}` : "/app/inbox"}
        className="mb-4 inline-flex min-h-10 items-center text-sm font-bold text-orange-deep"
      >
        ← 回到進件
      </Link>

      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-orange-deep">
            {workspace ? `${workspace.quote.quoteNo}・v${workspace.version.versionNo}` : "尚未建立報價"}
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-[-0.03em] text-ink">報價工作區</h1>
          <p className="mt-1 text-sm text-ink-3">
            {workspace?.customer.name ?? request?.contactName}・{workspace?.location.address ?? "請先確認服務地址"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-ink px-3 py-1 text-xs font-bold text-white">
          {workspace ? statusLabels[workspace.quote.status] : "新草稿"}
        </span>
      </header>

      {notice ? <div className="mb-4"><PilotInlineNotice tone={notice.tone}>{notice.text}</PilotInlineNotice></div> : null}

      <div className="mb-4 grid grid-cols-2 rounded-2xl border border-warm-border bg-white p-1" role="tablist" aria-label="報價檢視模式">
        <button type="button" role="tab" aria-selected={view === "internal"} onClick={() => setView("internal")} className={`min-h-11 rounded-xl text-sm font-bold ${view === "internal" ? "bg-ink text-white" : "text-ink-3"}`}>店內確認版</button>
        <button type="button" role="tab" aria-selected={view === "customer"} onClick={() => setView("customer")} className={`min-h-11 rounded-xl text-sm font-bold ${view === "customer" ? "bg-orange text-white" : "text-ink-3"}`}>客戶預覽版</button>
      </div>

      {editable ? (
        <div className="space-y-4">
          <PilotCard>
            <div className="space-y-4">
              <Field label="報價標題"><PilotInput aria-label="報價標題" value={draft.title} maxLength={160} onChange={(event) => updateDraft("title", event.target.value)} /></Field>
              <Field label="有效期限"><PilotInput aria-label="有效期限" type="date" value={draft.validUntil ?? ""} onChange={(event) => updateDraft("validUntil", event.target.value || null)} /></Field>
              <Field label="客戶說明"><PilotTextarea aria-label="客戶說明" value={draft.customerNotes} onChange={(event) => updateDraft("customerNotes", event.target.value)} /></Field>
              {view === "internal" ? <Field label="內部備註" hint="這段內容不會出現在客戶頁。"><PilotTextarea aria-label="內部備註" value={draft.internalNotes} onChange={(event) => updateDraft("internalNotes", event.target.value)} /></Field> : null}
              <Field label="付款與服務條款"><PilotTextarea aria-label="付款與服務條款" value={draft.terms} onChange={(event) => updateDraft("terms", event.target.value)} /></Field>
            </div>
          </PilotCard>

          {draft.items.map((line, index) => (
            <PilotCard key={line.clientId}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-black text-ink">品項 {index + 1}</h2>
                {draft.items.length > 1 ? <button type="button" className="text-xs font-bold text-[var(--warm-red)]" onClick={() => removeLine(index)}>移除</button> : null}
              </div>
              <div className="mt-4 space-y-3">
                <Field label="名稱"><PilotInput aria-label={`品項 ${index + 1} 名稱`} value={line.name} onChange={(event) => updateLine(index, "name", event.target.value)} /></Field>
                <Field label="服務範圍／規格"><PilotTextarea aria-label={`品項 ${index + 1} 服務範圍`} value={line.specification} onChange={(event) => updateLine(index, "specification", event.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="數量"><PilotInput aria-label={`品項 ${index + 1} 數量`} inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} /></Field>
                  <Field label="單位"><PilotInput aria-label={`品項 ${index + 1} 單位`} value={line.unit} onChange={(event) => updateLine(index, "unit", event.target.value)} /></Field>
                  <Field label="客戶單價"><PilotInput aria-label={`品項 ${index + 1} 客戶單價`} inputMode="numeric" value={line.unitPriceMinor} onChange={(event) => updateLine(index, "unitPriceMinor", event.target.value)} /></Field>
                  <Field label="折扣"><PilotInput aria-label={`品項 ${index + 1} 折扣`} inputMode="numeric" value={line.discountMinor} onChange={(event) => updateLine(index, "discountMinor", event.target.value)} /></Field>
                  {view === "internal" ? <Field label="內部成本"><PilotInput aria-label={`品項 ${index + 1} 內部成本`} inputMode="numeric" value={line.unitCostMinor} onChange={(event) => updateLine(index, "unitCostMinor", event.target.value)} /></Field> : null}
                  <Field label="稅率"><PilotSelect aria-label={`品項 ${index + 1} 稅率`} value={line.taxRate} onChange={(event) => updateLine(index, "taxRate", event.target.value)}><option value="0.0000">免稅／含稅價</option><option value="0.0500">外加 5%</option></PilotSelect></Field>
                </div>
              </div>
            </PilotCard>
          ))}
          <PilotButton variant="secondary" className="w-full" onClick={addLine}>＋ 新增品項</PilotButton>
        </div>
      ) : (
        <PilotCard>
          <h2 className="text-lg font-black text-ink">{workspace?.version.title}</h2>
          <div className="mt-4 divide-y divide-warm-border">
            {workspace?.version.items.map((line) => (
              <div key={line.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex justify-between gap-4"><div><p className="font-bold text-ink">{line.name}</p><p className="mt-1 text-xs leading-5 text-ink-3">{line.specification}</p><p className="mt-1 text-xs text-ink-2">{line.quantity} {line.unit} × {money(line.unitPriceMinor)}</p></div><p className="shrink-0 font-mono font-black text-ink">{money(line.totalMinor)}</p></div>
                {view === "internal" ? <p className="mt-2 rounded-lg bg-bg-warm px-3 py-2 text-xs font-semibold text-ink-3">內部成本：{money(line.unitCostMinor)}</p> : null}
              </div>
            ))}
          </div>
        </PilotCard>
      )}

      <PilotCard className="mt-4 bg-ink text-white">
        <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold text-white/60">客戶確認總額</p><p className="mt-1 text-xs text-white/55">金額以伺服器儲存結果為準</p></div><p className="font-mono text-2xl font-black">{money(totals?.totalMinor ?? workspace?.version.totalMinor ?? "0")}</p></div>
        {!totals && editable ? <p role="alert" className="mt-3 text-xs font-bold text-[#ffd2c7]">品項數量、單價、折扣或稅率格式不正確。</p> : null}
      </PilotCard>

      {editable ? (
        <PilotCard className="mt-4">
          <PilotButton className="w-full" disabled={busy !== null || !totals || draft.items.length === 0} onClick={() => void save()}>{busy === "save" ? "儲存中…" : workspace ? "儲存草稿" : "建立並儲存草稿"}</PilotButton>
          {workspace && canSend ? (
            <>
              <label className="mt-4 flex items-start gap-3 rounded-xl border border-warm-border bg-bg-warm p-3 text-sm font-bold text-ink-2"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-orange" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已檢查價格、範圍、效期與客戶版內容</span></label>
              <PilotButton className="mt-3 w-full" disabled={busy !== null || dirty || !confirmed} onClick={() => void send()}>{busy === "send" ? "鎖定版本中…" : "核准並建立分享連結"}</PilotButton>
              {dirty ? <p className="mt-2 text-center text-xs font-semibold text-ink-3">內容有變更，請先儲存草稿。</p> : null}
            </>
          ) : workspace ? <p className="mt-4 rounded-xl bg-bg-warm px-3 py-3 text-sm leading-6 text-ink-2">草稿已儲存。依目前 Pilot 政策，需由 owner／admin 開啟並核准送出。</p> : null}
        </PilotCard>
      ) : null}

      {publicUrl ? (
        <PilotCard className="mt-4 border-[var(--warm-green)]/20 bg-[var(--warm-green-soft)]/40">
          <h2 className="text-base font-black text-[var(--warm-green)]">客戶安全連結已建立</h2>
          <p className="mt-1 text-xs leading-5 text-ink-3">目前尚未接 LINE 自動通知；請複製後從既有 LINE 對話傳送。</p>
          <PilotInput className="mt-3 font-mono text-xs" aria-label="客戶報價連結" readOnly value={publicUrl} onFocus={(event) => event.currentTarget.select()} />
          <PilotButton className="mt-3 w-full" onClick={() => void copyPublicUrl()}>複製客戶報價連結</PilotButton>
        </PilotCard>
      ) : null}

      {workspace && ["sent", "viewed", "accepted", "rejected"].includes(workspace.quote.status) ? (
        <PilotCard className="mt-4">
          {workspace.quote.status === "accepted" ? <><h2 className="text-lg font-black text-[var(--warm-green)]">客戶已接受 v{workspace.version.versionNo}</h2><p className="mt-1 text-sm leading-6 text-ink-2">確認金額 {money(workspace.version.totalMinor)} 已保留，可回到進件建立單次工單或工程專案。</p><Link href={`/app/inbox/${workspace.request.id}`} className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-orange px-4 text-sm font-bold text-white">回到進件並建立案件</Link></> : null}
          {workspace.quote.status === "rejected" ? <><h2 className="text-lg font-black text-[var(--warm-red)]">客戶已拒絕這一版</h2><p className="mt-1 text-sm leading-6 text-ink-2">舊版本會永久保留；請複製成新版後調整內容。</p><PilotButton className="mt-4 w-full" disabled={busy !== null} onClick={() => void cloneRevision()}>{busy === "clone" ? "建立中…" : "複製成新版草稿"}</PilotButton></> : null}
          {workspace.quote.status === "sent" || workspace.quote.status === "viewed" ? <><h2 className="text-lg font-black text-ink">等待客戶確認</h2><p className="mt-1 text-sm leading-6 text-ink-2">{workspace.quote.status === "viewed" ? "客戶已開啟連結，但尚未接受或拒絕。" : "報價已鎖定，尚未收到客戶回覆。"}</p></> : null}
          {!publicUrl && canSend ? <div className="mt-4">{rotateConfirm ? <div className="rounded-xl border border-orange/25 bg-orange-soft p-3"><p className="text-sm font-bold text-orange-deep">建立新連結會讓先前連結失效。</p><div className="mt-3 grid grid-cols-2 gap-2"><PilotButton variant="secondary" onClick={() => setRotateConfirm(false)}>取消</PilotButton><PilotButton disabled={busy !== null} onClick={() => void rotateLink()}>{busy === "rotate" ? "處理中…" : "確認更新"}</PilotButton></div></div> : <PilotButton variant="secondary" className="w-full" onClick={() => setRotateConfirm(true)}>重新產生分享連結</PilotButton>}</div> : null}
        </PilotCard>
      ) : null}
    </PilotPage>
  );
}
