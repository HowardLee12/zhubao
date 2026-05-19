import Link from "next/link";
import type { ReactNode } from "react";

const CHIP_CLASS =
  "inline-flex items-center gap-0.5 pl-3 pr-2 py-1 rounded-full bg-orange-soft text-orange-deep text-[12px] font-semibold active:scale-95 transition-transform";

function Chevron() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="-mr-0.5"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function SectionHeader({
  title,
  action,
}: Readonly<{
  title: ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
}>) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-2">
      <div className="text-[13px] font-semibold text-ink-2 tracking-wider">
        {title}
      </div>
      {action &&
        (action.href ? (
          <Link href={action.href} className={CHIP_CLASS}>
            {action.label}
            <Chevron />
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className={CHIP_CLASS}>
            {action.label}
            <Chevron />
          </button>
        ))}
    </div>
  );
}
