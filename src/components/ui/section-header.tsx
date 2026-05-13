import Link from "next/link";
import type { ReactNode } from "react";

export function SectionHeader({
  title,
  action,
}: {
  title: ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  return (
    <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
      <div className="text-[13px] font-semibold text-ink-2 tracking-wider">
        {title}
      </div>
      {action &&
        (action.href ? (
          <Link
            href={action.href}
            className="text-[13px] text-orange font-medium"
          >
            {action.label} ›
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="text-[13px] text-orange font-medium"
          >
            {action.label} ›
          </button>
        ))}
    </div>
  );
}
