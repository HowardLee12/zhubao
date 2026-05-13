import type { ReactNode } from "react";

export function HeroCard({
  eyebrow,
  title,
  stats,
  progress,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  stats?: { label: string; value: ReactNode; sub?: ReactNode }[];
  progress?: number;
  children?: ReactNode;
}) {
  return (
    <div
      className="mx-4 my-3 rounded-2xl p-5 text-white"
      style={{
        background: "linear-gradient(135deg, #E2691F 0%, #A04428 100%)",
      }}
    >
      {eyebrow && (
        <div className="text-[11px] opacity-80 tracking-wider font-medium">
          {eyebrow}
        </div>
      )}
      <div className="text-lg font-bold mt-1 leading-snug">{title}</div>

      {stats && stats.length > 0 && (
        <div
          className="grid gap-3 mt-4 pt-3.5 border-t border-white/20"
          style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
        >
          {stats.map((s) => (
            <div key={s.label}>
              <div className="text-[10px] opacity-75">{s.label}</div>
              <div className="font-mono text-base font-bold mt-0.5 tabular-nums">
                {s.value}
              </div>
              {s.sub && <div className="text-[10px] opacity-70 mt-0.5">{s.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {progress !== undefined && (
        <div className="h-1 rounded-full mt-3 bg-white/25 overflow-hidden">
          <div
            className="h-full bg-white rounded-full transition-all"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}

      {children}
    </div>
  );
}
