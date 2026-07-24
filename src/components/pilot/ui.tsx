import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function PilotPage({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background px-4 pb-12 pt-5 text-ink sm:px-6">
      <div className="mx-auto w-full max-w-[430px]">{children}</div>
    </main>
  );
}

export function PilotBrand({ eyebrow }: { eyebrow?: string }) {
  return (
    <header className="mb-6 flex items-center justify-between gap-4">
      <div>
        <p className="text-xl font-black tracking-[-0.04em] text-ink">Renoly</p>
        {eyebrow ? (
          <p className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-orange-deep">
            {eyebrow}
          </p>
        ) : null}
      </div>
      <span className="inline-flex min-h-8 items-center rounded-full bg-orange-soft px-3 text-[11px] font-bold text-orange-deep">
        Pilot
      </span>
    </header>
  );
}

export function PilotCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[24px] border border-warm-border bg-white p-5 shadow-[0_18px_45px_rgba(74,45,20,0.08)] ${className}`}
    >
      {children}
    </section>
  );
}

export function PilotButton({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  const variantClass = {
    primary:
      "bg-orange text-white shadow-[0_10px_25px_rgba(226,105,31,0.22)] hover:bg-orange-deep",
    secondary:
      "border border-warm-border-strong bg-white text-ink hover:border-orange/50 hover:bg-orange-soft/40",
    danger:
      "border border-[var(--warm-red)]/30 bg-[var(--warm-red-soft)] text-[var(--warm-red)] hover:border-[var(--warm-red)]/60",
  }[variant];

  return (
    <button
      type="button"
      className={`inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variantClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function PilotLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4 py-8">
      <span className="sr-only">{label}</span>
      <div className="h-8 w-40 animate-pulse rounded-lg bg-warm-border motion-reduce:animate-none" />
      <div className="h-44 animate-pulse rounded-[24px] bg-white motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-[24px] bg-white motion-reduce:animate-none" />
    </div>
  );
}

export function PilotError({
  title,
  description,
  actionLabel,
  onRetry,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onRetry: () => void;
}) {
  return (
    <PilotCard className="py-10 text-center">
      <div role="alert">
        <span
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--warm-red-soft)] text-2xl font-black text-[var(--warm-red)]"
        >
          !
        </span>
        <h1 className="mt-4 text-xl font-black tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">{description}</p>
      </div>
      <PilotButton className="mt-6 w-full" onClick={onRetry}>
        {actionLabel}
      </PilotButton>
    </PilotCard>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      {label ? <p className="mb-1.5 text-sm font-bold text-ink-2">{label}</p> : null}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-semibold text-[var(--warm-red)]">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs leading-5 text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

const fieldClass =
  "min-h-12 w-full rounded-xl border border-warm-border-strong bg-white px-3.5 text-base text-ink outline-none transition placeholder:text-ink-4 focus:border-orange focus:ring-2 focus:ring-orange/15 disabled:bg-bg-warm";

export function PilotInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldClass} ${className}`} {...props} />;
}

export function PilotSelect({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${fieldClass} ${className}`} {...props} />;
}

export function PilotTextarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} min-h-28 py-3 ${className}`} {...props} />;
}

export function PilotInlineNotice({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "success" | "info";
}) {
  const styles = {
    error: "border-[var(--warm-red)]/20 bg-[var(--warm-red-soft)] text-[var(--warm-red)]",
    success:
      "border-[var(--warm-green)]/20 bg-[var(--warm-green-soft)] text-[var(--warm-green)]",
    info: "border-orange/20 bg-orange-soft text-orange-deep",
  };

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`rounded-xl border px-3.5 py-3 text-sm font-semibold leading-5 ${styles[tone]}`}
    >
      {children}
    </div>
  );
}
