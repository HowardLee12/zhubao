import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { DemoNotice as DemoNoticeType } from "@/lib/v2-demo/types";

import { V2Icon, type V2IconName } from "./icons";

export function formatDemoMoney(value: number): string {
  return `NT$ ${new Intl.NumberFormat("zh-TW").format(value)}`;
}

export function V2Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[22px] border border-[#eadfce] bg-white shadow-[0_14px_40px_rgba(74,45,20,0.07)] ${className}`}
    >
      {children}
    </section>
  );
}

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export function V2Button({
  children,
  icon,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: V2IconName;
  variant?: ButtonVariant;
}) {
  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-orange text-white shadow-[0_10px_25px_rgba(226,105,31,0.24)] hover:bg-orange-deep",
    secondary:
      "border border-warm-border-strong bg-white text-ink hover:border-orange/50 hover:bg-orange-soft/40",
    quiet: "bg-bg-warm text-ink-2 hover:bg-orange-soft hover:text-orange-deep",
    danger: "bg-[var(--warm-red-soft)] text-[var(--warm-red)] hover:brightness-95",
  };

  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${className}`}
      {...props}
    >
      {icon ? <V2Icon name={icon} className="h-[18px] w-[18px]" /> : null}
      {children}
    </button>
  );
}

export function V2IconButton({
  label,
  icon,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: V2IconName;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border border-warm-border bg-white text-ink-2 transition hover:border-orange/50 hover:text-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange ${className}`}
      {...props}
    >
      <V2Icon name={icon} />
    </button>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "orange" | "blue" | "green" | "red" | "purple";
}) {
  const tones = {
    neutral: "bg-bg-warm text-ink-2",
    orange: "bg-orange-soft text-orange-deep",
    blue: "bg-[#e6effc] text-[#2e5f9f]",
    green: "bg-[var(--warm-green-soft)] text-[var(--warm-green)]",
    red: "bg-[var(--warm-red-soft)] text-[var(--warm-red)]",
    purple: "bg-[#eee8f8] text-[#6b4c91]",
  };

  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function DemoAvatar({
  initial,
  size = "md",
  tone = "orange",
}: {
  initial: string;
  size?: "sm" | "md" | "lg";
  tone?: "orange" | "ink" | "green";
}) {
  const sizes = {
    sm: "h-9 w-9 text-sm",
    md: "h-11 w-11 text-base",
    lg: "h-14 w-14 text-lg",
  };
  const tones = {
    orange: "bg-orange-soft text-orange-deep",
    ink: "bg-ink text-white",
    green: "bg-[var(--warm-green-soft)] text-[var(--warm-green)]",
  };

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-2xl font-bold ${sizes[size]} ${tones[tone]}`}
    >
      {initial}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  right,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-orange-deep">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-ink-3">{description}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function DemoNotice({ notice }: { notice: DemoNoticeType }) {
  const isDanger = notice.tone === "danger";
  const styles = {
    success: "border-[var(--warm-green)]/20 bg-[var(--warm-green-soft)] text-[var(--warm-green)]",
    danger: "border-[var(--warm-red)]/20 bg-[var(--warm-red-soft)] text-[var(--warm-red)]",
    info: "border-orange/20 bg-orange-soft text-orange-deep",
  };

  return (
    <div
      role={isDanger ? "alert" : "status"}
      aria-live="polite"
      className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm font-semibold leading-5 ${styles[notice.tone]}`}
    >
      <V2Icon name={isDanger ? "alert" : "check"} className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{notice.message}</span>
    </div>
  );
}

export function DemoSkeleton() {
  return (
    <div role="status" aria-label="示範內容載入中" className="space-y-4 py-2">
      <span className="sr-only">示範內容載入中</span>
      <div className="h-8 w-36 animate-pulse rounded-lg bg-warm-border motion-reduce:animate-none" />
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-24 animate-pulse rounded-2xl bg-white motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="space-y-3 rounded-[22px] border border-warm-border bg-white p-5">
        <div className="h-5 w-2/3 animate-pulse rounded bg-warm-border motion-reduce:animate-none" />
        <div className="h-4 w-full animate-pulse rounded bg-bg-warm motion-reduce:animate-none" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-bg-warm motion-reduce:animate-none" />
        <div className="h-12 w-full animate-pulse rounded-xl bg-orange-soft motion-reduce:animate-none" />
      </div>
    </div>
  );
}

export function DemoEmptyState({ onRestore }: { onRestore: () => void }) {
  return (
    <V2Card className="flex min-h-[390px] flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-[22px] bg-orange-soft text-orange-deep">
        <V2Icon name="inbox" className="h-7 w-7" />
      </span>
      <h1 className="text-xl font-bold text-ink">目前沒有待處理進件</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-ink-3">
        新的 LINE、電話或公開表單需求會集中出現在這裡，不再靠聊天紀錄找案件。
      </p>
      <V2Button className="mt-6" icon="refresh" onClick={onRestore}>
        載入示範進件
      </V2Button>
    </V2Card>
  );
}

export function DemoErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <V2Card className="flex min-h-[390px] flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-[22px] bg-[var(--warm-red-soft)] text-[var(--warm-red)]">
        <V2Icon name="alert" className="h-7 w-7" />
      </span>
      <h1 className="text-xl font-bold text-ink">這個區塊暫時讀不到</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-ink-3">
        示範資料沒有遺失。你可以重試載入，其他流程仍保持原本狀態。
      </p>
      <V2Button className="mt-6" icon="refresh" onClick={onRetry}>
        重試載入
      </V2Button>
      <p className="mt-3 font-mono text-[11px] text-ink-3">參考碼 DEMO-PARTIAL-01</p>
    </V2Card>
  );
}

export function MetaRow({
  icon,
  children,
}: {
  icon: V2IconName;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm leading-5 text-ink-2">
      <V2Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
      <span>{children}</span>
    </div>
  );
}

