import type { ReactNode } from "react";

type Variant =
  | "neutral"
  | "orange"
  | "brick"
  | "green"
  | "amber"
  | "red"
  | "dark";

const variantClass: Record<Variant, string> = {
  neutral: "bg-bg-warm text-ink-2",
  orange: "bg-orange-soft text-orange-deep",
  brick: "bg-brick-soft text-brick",
  green: "bg-[var(--warm-green-soft)] text-[var(--warm-green)]",
  amber: "bg-amber-soft text-amber",
  red: "bg-[var(--warm-red-soft)] text-[var(--warm-red)]",
  dark: "bg-ink text-white",
};

export function Pill({
  children,
  variant = "neutral",
  className = "",
}: {
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${variantClass[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
