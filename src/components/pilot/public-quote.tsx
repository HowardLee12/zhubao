"use client";

import { useEffect, useState } from "react";

import type { PublicQuote, PublicQuoteResponse } from "@/schemas/quote";

import { PilotApiError } from "./api";
import { fetchPublicQuote, respondPublicQuote } from "./quote-api";
import {
  Field,
  PilotBrand,
  PilotButton,
  PilotCard,
  PilotInlineNotice,
  PilotInput,
  PilotLoading,
  PilotPage,
  PilotTextarea,
} from "./ui";

type PageState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "ready"; quote: PublicQuote };

type Decision = PublicQuoteResponse["decision"];

function money(value: string): string {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return `NT$${value}`;
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string | null): string {
  if (!value) return "未設定期限";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "long",
    timeZone: "Asia/Taipei",
  }).format(new Date(`${value}T00:00:00+08:00`));
}

const decisionLabels: Record<Decision, string> = {
  accept: "接受報價",
  reject: "暫不接受",
};

export function PilotPublicQuote({ token }: Readonly<{ token: string }>) {
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [displayName, setDisplayName] = useState("");
  const [comment, setComment] = useState("");
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void fetchPublicQuote(token)
      .then((quote) => {
        if (!active) return;
        setState({ status: "ready", quote });
        if (quote.decision) setDisplayName(quote.decision.displayName);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof PilotApiError && error.status === 404) {
          setState({ status: "not-found" });
          return;
        }
        setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [attempt, token]);

  async function confirmDecision() {
    if (state.status !== "ready" || !pendingDecision || !displayName.trim()) {
      setNotice("請先填寫確認人姓名。");
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      const record = await respondPublicQuote(token, globalThis.crypto.randomUUID(), {
        decision: pendingDecision,
        displayName: displayName.trim(),
        comment: comment.trim() || null,
      });
      setState({
        status: "ready",
        quote: {
          ...state.quote,
          status: record.decision === "accept" ? "accepted" : "rejected",
          decision: {
            decision: record.decision,
            recordedAt: record.recordedAt,
            displayName: record.displayName,
            comment: record.comment,
          },
        },
      });
      setPendingDecision(null);
      setNotice(record.decision === "accept" ? "已記錄接受報價。" : "已記錄暫不接受。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "回覆未送出，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="客戶報價" />
        <PilotLoading label="正在載入報價" />
      </PilotPage>
    );
  }

  if (state.status === "not-found") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="客戶報價" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-xl font-black text-ink">這個報價連結無法使用</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            連結可能已更新、撤回或失效，請回到原本的 LINE 對話向店家索取新連結。
          </p>
        </PilotCard>
      </PilotPage>
    );
  }

  if (state.status === "error") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="客戶報價" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-xl font-black text-ink">暫時無法載入報價</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">請確認網路連線後再試一次。</p>
          <PilotButton className="mt-5 w-full" onClick={() => setAttempt((value) => value + 1)}>
            重新載入
          </PilotButton>
        </PilotCard>
      </PilotPage>
    );
  }

  const { quote } = state;
  const canRespond = quote.status === "sent" || quote.status === "viewed";

  return (
    <PilotPage>
      <PilotBrand eyebrow="客戶報價" />
      <header className="mb-4">
        <p className="text-xs font-bold text-orange-deep">{quote.merchant.name}</p>
        <h1 className="mt-1 text-2xl font-black tracking-[-0.03em] text-ink">{quote.title}</h1>
        <p className="mt-2 text-sm text-ink-3">
          {quote.quoteNo}・第 {quote.versionNo} 版・有效至 {formatDate(quote.validUntil)}
        </p>
      </header>

      {notice ? (
        <div className="mb-4">
          <PilotInlineNotice tone={quote.decision ? "success" : "error"}>{notice}</PilotInlineNotice>
        </div>
      ) : null}

      {quote.decision ? (
        <PilotCard className="mb-4 border-[var(--warm-green)]/25 bg-[var(--warm-green-soft)]/40">
          <p className="text-sm font-black text-[var(--warm-green)]">
            {quote.decision.decision === "accept" ? "已接受這份報價" : "已回覆暫不接受"}
          </p>
          <p className="mt-1 text-sm leading-6 text-ink-2">
            確認人：{quote.decision.displayName}
          </p>
          {quote.decision.comment ? (
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-white/70 px-3 py-2 text-sm text-ink-2">
              {quote.decision.comment}
            </p>
          ) : null}
        </PilotCard>
      ) : null}

      <PilotCard>
        <div className="divide-y divide-warm-border">
          {quote.items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-bold text-ink">{item.name}</p>
                  {item.specification ? (
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-ink-3">
                      {item.specification}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-ink-2">
                    {item.quantity} {item.unit} × {money(item.unitPriceMinor)}
                  </p>
                </div>
                <p className="shrink-0 font-mono font-black text-ink">{money(item.totalMinor)}</p>
              </div>
              {item.discountMinor !== "0" ? (
                <p className="mt-1 text-right text-xs font-semibold text-[var(--warm-green)]">
                  已含折扣 {money(item.discountMinor)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </PilotCard>

      <PilotCard className="mt-4 bg-ink text-white">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4 text-white/70">
            <dt>未稅小計</dt>
            <dd>{money(quote.subtotalMinor)}</dd>
          </div>
          {quote.discountMinor !== "0" ? (
            <div className="flex justify-between gap-4 text-white/70">
              <dt>折扣</dt>
              <dd>-{money(quote.discountMinor)}</dd>
            </div>
          ) : null}
          {quote.taxMinor !== "0" ? (
            <div className="flex justify-between gap-4 text-white/70">
              <dt>稅額</dt>
              <dd>{money(quote.taxMinor)}</dd>
            </div>
          ) : null}
          <div className="flex items-end justify-between gap-4 border-t border-white/15 pt-3">
            <dt className="font-bold">報價總額</dt>
            <dd className="font-mono text-2xl font-black">{money(quote.totalMinor)}</dd>
          </div>
        </dl>
      </PilotCard>

      {quote.customerNotes || quote.terms ? (
        <PilotCard className="mt-4">
          {quote.customerNotes ? (
            <div>
              <h2 className="text-sm font-black text-ink">報價說明</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-2">
                {quote.customerNotes}
              </p>
            </div>
          ) : null}
          {quote.terms ? (
            <div className={quote.customerNotes ? "mt-4 border-t border-warm-border pt-4" : ""}>
              <h2 className="text-sm font-black text-ink">付款與服務條款</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-2">{quote.terms}</p>
            </div>
          ) : null}
        </PilotCard>
      ) : null}

      {canRespond ? (
        <PilotCard className="mt-4">
          <h2 className="text-lg font-black text-ink">回覆店家</h2>
          <p className="mt-1 text-sm leading-6 text-ink-3">
            不需註冊帳號。系統只會記錄你的姓名、選擇與備註。
          </p>
          <div className="mt-4 space-y-3">
            <Field label="確認人姓名">
              <PilotInput
                aria-label="確認人姓名"
                autoComplete="name"
                maxLength={120}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
            <Field label="備註（選填）">
              <PilotTextarea
                aria-label="給店家的備註"
                maxLength={2000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <PilotButton variant="secondary" onClick={() => setPendingDecision("reject")}>
              暫不接受
            </PilotButton>
            <PilotButton onClick={() => setPendingDecision("accept")}>接受報價</PilotButton>
          </div>
          <p className="mt-3 text-xs leading-5 text-ink-3">
            此操作用於確認服務意向與報價版本，不取代依法另需簽署的契約或文件。
          </p>
        </PilotCard>
      ) : null}

      {pendingDecision ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-4 sm:items-center sm:justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="quote-decision-title"
            className="w-full max-w-sm rounded-[24px] bg-white p-5 shadow-2xl"
          >
            <h2 id="quote-decision-title" className="text-xl font-black text-ink">
              確認「{decisionLabels[pendingDecision]}」？
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-3">
              你正在回覆第 {quote.versionNo} 版，總額 {money(quote.totalMinor)}。送出後請聯絡店家才能修改。
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <PilotButton
                variant="secondary"
                disabled={submitting}
                onClick={() => setPendingDecision(null)}
              >
                返回檢查
              </PilotButton>
              <PilotButton
                variant={pendingDecision === "reject" ? "danger" : "primary"}
                disabled={submitting}
                onClick={() => void confirmDecision()}
              >
                {submitting ? "送出中…" : "確認送出"}
              </PilotButton>
            </div>
          </div>
        </div>
      ) : null}
    </PilotPage>
  );
}
