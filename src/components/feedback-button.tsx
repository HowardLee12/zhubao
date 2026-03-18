"use client";

import { useState, useRef, useEffect } from "react";

const FEEDBACK_URL = process.env.NEXT_PUBLIC_FEEDBACK_SHEET_URL ?? "";
const MAX_LENGTH = 1000;

type FeedbackType = "bug" | "feature" | "other";

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "問題回報",
  feature: "功能建議",
  other: "其他",
};

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("feature");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Focus textarea when modal opens
  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Reset form when closing
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setMessage("");
        setType("feature");
        setSent(false);
        setError(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Cleanup auto-close timer on unmount
  useEffect(() => {
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, []);

  // Don't render if no URL configured
  if (!FEEDBACK_URL) return null;

  async function handleSubmit() {
    const trimmed = message.trim();
    if (!trimmed) return;

    setSending(true);
    setError(false);
    try {
      // Google Apps Script redirects on POST, so no-cors is required.
      // We cannot detect server-side errors, but network errors are caught.
      await fetch(FEEDBACK_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          type,
          message: trimmed.slice(0, MAX_LENGTH),
          page: globalThis.location?.pathname ?? "",
        }),
      });
      setSent(true);
      autoCloseRef.current = setTimeout(() => setOpen(false), 1200);
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Floating button — above bottom nav */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-24 z-40 w-11 h-11 rounded-full bg-sage-600 text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        aria-label="回饋意見"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="意見回饋"
            className="w-full max-w-[430px] bg-card rounded-t-2xl p-5 pb-8 animate-in slide-in-from-bottom duration-200"
          >
            {sent ? (
              <div className="text-center py-8">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2 text-green-600">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <div className="text-sm font-medium text-sage-800">感謝您的回饋!</div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-sage-800">意見回饋</h3>
                  <button
                    onClick={() => setOpen(false)}
                    className="text-sage-400 p-1"
                    aria-label="關閉"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                {/* Type selector */}
                <div className="flex gap-2 mb-3">
                  {(Object.keys(TYPE_LABELS) as FeedbackType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setType(t)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        type === t
                          ? "bg-sage-600 text-white"
                          : "bg-sage-100 text-sage-600"
                      }`}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>

                {/* Message input */}
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={MAX_LENGTH}
                  placeholder="請描述您遇到的問題或想要的功能..."
                  rows={4}
                  className="w-full rounded-xl border border-sage-200 bg-sage-50 px-3 py-2.5 text-sm text-sage-800 placeholder:text-sage-400 focus:outline-none focus:ring-2 focus:ring-sage-300 resize-none"
                />
                <div className="text-right text-[11px] text-sage-400 mt-1">
                  {message.length}/{MAX_LENGTH}
                </div>

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={!message.trim() || sending}
                  className="w-full mt-2 py-2.5 rounded-xl bg-sage-600 text-white text-sm font-medium disabled:opacity-40 active:scale-[0.98] transition-transform"
                >
                  {sending ? "送出中..." : "送出回饋"}
                </button>

                {error && (
                  <p className="text-xs text-red-500 text-center mt-2">
                    送出失敗，請稍後再試
                  </p>
                )}

                <p className="text-[10px] text-sage-400 text-center mt-3">
                  回饋內容僅用於改善產品體驗
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
