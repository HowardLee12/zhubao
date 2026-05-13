"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function IconHome({ className }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function IconFileText({ className }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function IconCalendar({ className }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconDollarSign({ className }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function IconUser({ className }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

const navItems = [
  { href: "/dashboard", icon: IconHome, label: "案件" },
  { href: "/schedule", icon: IconCalendar, label: "排程" },
  { href: "/payments", icon: IconDollarSign, label: "收款" },
  { href: "/account", icon: IconUser, label: "帳號" },
];

// Routes where the tab bar should be hidden (immersive previews)
const HIDDEN_ROUTES = ["/line-preview"];

export function BottomNav() {
  const pathname = usePathname();
  if (HIDDEN_ROUTES.some((p) => pathname.endsWith(p) || pathname.includes(`${p}/`))) {
    return null;
  }

  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] grid grid-cols-4 z-50 border-t border-warm-border"
      style={{
        background: "rgba(255, 251, 244, 0.92)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        paddingBottom: "env(safe-area-inset-bottom, 8px)",
      }}
    >
      {navItems.map((item) => {
        const isActive = pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href));
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={true}
            className={`flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
              isActive ? "text-orange" : "text-ink-3"
            }`}
          >
            <Icon />
            <span className={`text-[10px] tracking-wide ${isActive ? "font-semibold" : "font-medium"}`}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
