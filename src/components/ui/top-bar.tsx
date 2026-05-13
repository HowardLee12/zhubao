import type { ReactNode } from "react";

export function TopBar({
  title,
  subtitle,
  right,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-md px-5 pt-4 pb-2 flex items-center gap-3">
      {back && <div className="shrink-0">{back}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-xl font-bold tracking-tight leading-tight text-ink truncate">
          {title}
        </div>
        {subtitle && (
          <div className="text-xs text-ink-3 mt-0.5 font-mono tracking-wide truncate">
            {subtitle}
          </div>
        )}
      </div>
      {right && <div className="shrink-0 flex items-center gap-1.5">{right}</div>}
    </header>
  );
}

export function TopBarIconButton({
  children,
  onClick,
  variant = "default",
  href,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "alert";
  href?: string;
  ariaLabel?: string;
}) {
  const style =
    variant === "primary"
      ? "bg-orange text-white border-orange"
      : variant === "alert"
      ? "bg-warm-red-soft border-warm-red text-warm-red"
      : "bg-surface border-warm-border text-ink-2";

  const className = `w-9 h-9 rounded-xl border flex items-center justify-center transition-colors ${style}`;

  if (href) {
    return (
      <a href={href} aria-label={ariaLabel} className={className}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} className={className}>
      {children}
    </button>
  );
}
