"use client";

import { useState } from "react";

const FEEDBACK_URL = process.env.NEXT_PUBLIC_FEEDBACK_SHEET_URL ?? "";

const PRICE_OPTIONS = [199, 299, 399, 499, 599, 799];

export function PricingSurvey({ userId, userName }: { userId: string; userName: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!FEEDBACK_URL) return null;

  const finalPrice = selected === -1 ? Number(custom) || 0 : selected;

  async function handleSubmit() {
    if (finalPrice === null || finalPrice <= 0) return;

    setSending(true);
    try {
      await fetch(FEEDBACK_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          userId,
          userName,
          type: "pricing",
          message: `願付價格: NT$${finalPrice}/月`,
          page: "/account",
        }),
      });
      setSent(true);
    } catch {
      // non-critical
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-sage-50 border border-sage-200 rounded-xl p-4">
      <div className="text-sm font-bold text-sage-800 mb-1">升級專業版</div>
      <div className="text-xs text-sage-600 mb-3">解鎖所有功能，無限制使用</div>

      {/* Feature list */}
      <div className="text-xs text-sage-600 space-y-1 mb-4">
        {["無限報價單", "無限案件管理", "無限施工照片", "報價分享給屋主", "工班排程通知"].map((feat) => (
          <div key={feat} className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary shrink-0">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{feat}</span>
          </div>
        ))}
      </div>

      {sent ? (
        <div className="text-center py-4">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2 text-green-600">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <div className="text-sm font-medium text-sage-800">感謝你的回饋!</div>
          <div className="text-xs text-muted-foreground mt-1">我們會參考你的意見來定價</div>
        </div>
      ) : (
        <>
          <div className="text-xs font-medium text-sage-700 mb-2">
            你願意每月付多少使用專業版？
          </div>

          {/* Price options */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {PRICE_OPTIONS.map((price) => (
              <button
                key={price}
                onClick={() => { setSelected(price); setCustom(""); }}
                className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                  selected === price
                    ? "bg-primary text-white"
                    : "bg-white border border-sage-200 text-sage-700"
                }`}
              >
                ${price}
              </button>
            ))}
          </div>

          {/* Custom price */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setSelected(-1)}
              className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                selected === -1
                  ? "bg-primary text-white"
                  : "bg-white border border-sage-200 text-sage-700"
              }`}
            >
              其他金額
            </button>
            {selected === -1 && (
              <div className="flex items-center gap-1 flex-1">
                <span className="text-sm text-sage-600">NT$</span>
                <input
                  type="number"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="輸入金額"
                  min={0}
                  className="flex-1 px-2 py-1.5 rounded-lg border border-sage-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-300"
                />
                <span className="text-xs text-sage-400">/月</span>
              </div>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={!finalPrice || finalPrice <= 0 || sending}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-xl font-semibold text-sm disabled:opacity-40 active:scale-[0.98] transition-transform"
          >
            {sending ? "送出中..." : "送出我的回饋"}
          </button>
        </>
      )}
    </div>
  );
}
