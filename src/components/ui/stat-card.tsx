import type { ReactNode } from "react";

type Variant = "default" | "accent" | "dark";

export function StatCard({
  label,
  value,
  delta,
  deltaColor,
  variant = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  deltaColor?: "default" | "success" | "danger";
  variant?: Variant;
}) {
  const containerStyle =
    variant === "accent"
      ? "bg-orange text-white border-orange"
      : variant === "dark"
      ? "bg-ink text-white border-ink"
      : "bg-surface text-ink border-warm-border";

  const labelStyle =
    variant === "default" ? "text-ink-2" : "text-white/70";

  const deltaStyleBase =
    variant === "default" ? "text-ink-3" : "text-white/55";
  const deltaColorOverride =
    deltaColor === "success"
      ? "text-warm-green"
      : deltaColor === "danger"
      ? "text-warm-red"
      : "";

  return (
    <div className={`rounded-2xl p-3.5 border ${containerStyle}`}>
      <div className={`text-[11px] font-medium tracking-wide ${labelStyle}`}>
        {label}
      </div>
      <div className="font-mono text-[22px] font-semibold mt-1 leading-tight tabular-nums tracking-tight">
        {value}
      </div>
      {delta && (
        <div className={`text-[11px] mt-0.5 ${deltaColorOverride || deltaStyleBase}`}>
          {delta}
        </div>
      )}
    </div>
  );
}
