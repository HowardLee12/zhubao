import Link from "next/link";

// Shown on the dashboard for users who have at least one project but
// haven't reached the activation moment (first quote) yet. Disappears
// once they've made a quote.
export function OnboardingChecklist({
  firstProjectId,
}: Readonly<{ firstProjectId: string }>) {
  const steps = [
    { label: "建立案件", done: true, href: undefined as string | undefined },
    { label: "做出第一張報價", done: false, href: `/projects/${firstProjectId}` },
    { label: "LINE 分享報價給屋主", done: false, href: undefined },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="mx-4 mt-3 bg-surface border border-warm-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[13px] font-bold text-ink">完成設定</div>
        <div className="text-[11px] text-ink-3 font-mono">
          {doneCount}/{steps.length}
        </div>
      </div>

      <div className="space-y-1.5">
        {steps.map((s) => {
          const row = (
            <div className="flex items-center gap-2.5">
              <div
                className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  s.done
                    ? "bg-[var(--warm-green)] border-[var(--warm-green)]"
                    : "border-warm-border-strong"
                }`}
              >
                {s.done && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span
                className={`text-[13px] ${
                  s.done ? "text-ink-3 line-through" : "text-ink font-medium"
                }`}
              >
                {s.label}
              </span>
              {!s.done && s.href && (
                <span className="ml-auto text-[12px] text-orange font-semibold">
                  去做 ›
                </span>
              )}
            </div>
          );
          return s.href && !s.done ? (
            <Link key={s.label} href={s.href} className="block active:opacity-70">
              {row}
            </Link>
          ) : (
            <div key={s.label}>{row}</div>
          );
        })}
      </div>

      <div className="text-[11px] text-ink-3 mt-3">
        做出第一張報價就解鎖 Renoly 的核心：成本／客戶價／利潤自動換算
      </div>
    </div>
  );
}
