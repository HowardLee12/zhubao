import type { SVGProps } from "react";

export type V2IconName =
  | "alert"
  | "arrow"
  | "briefcase"
  | "calendar"
  | "camera"
  | "check"
  | "chevron"
  | "clock"
  | "cloud"
  | "file"
  | "image"
  | "inbox"
  | "line"
  | "location"
  | "lock"
  | "phone"
  | "plus"
  | "quote"
  | "refresh"
  | "route"
  | "send"
  | "shield"
  | "sparkles"
  | "user"
  | "wrench";

export function V2Icon({
  name,
  className = "h-5 w-5",
  ...props
}: { name: V2IconName } & SVGProps<SVGSVGElement>) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
    ...props,
  };

  switch (name) {
    case "alert":
      return (
        <svg {...commonProps}>
          <path d="M12 3 2.8 19a1.4 1.4 0 0 0 1.2 2h16a1.4 1.4 0 0 0 1.2-2L12 3Z" />
          <path d="M12 9v4.5" />
          <path d="M12 17.5h.01" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...commonProps}>
          <path d="M5 12h14" />
          <path d="m14 7 5 5-5 5" />
        </svg>
      );
    case "briefcase":
      return (
        <svg {...commonProps}>
          <rect x="3" y="7" width="18" height="13" rx="2.5" />
          <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" />
          <path d="M3 12h18M10 12v2h4v-2" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...commonProps}>
          <rect x="3" y="5" width="18" height="16" rx="2.5" />
          <path d="M8 3v4M16 3v4M3 10h18" />
          <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
        </svg>
      );
    case "camera":
      return (
        <svg {...commonProps}>
          <path d="M5 7h2l1.3-2h7.4L17 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      );
    case "check":
      return (
        <svg {...commonProps}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...commonProps}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "clock":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "cloud":
      return (
        <svg {...commonProps}>
          <path d="M6.5 19a4.5 4.5 0 0 1-.8-8.9A6.5 6.5 0 0 1 18 9a5 5 0 0 1-.5 10H6.5Z" />
          <path d="m9 15 3-3 3 3M12 12v7" />
        </svg>
      );
    case "file":
      return (
        <svg {...commonProps}>
          <path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M14 3v5h5M8 13h8M8 17h5" />
        </svg>
      );
    case "image":
      return (
        <svg {...commonProps}>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <circle cx="8.5" cy="9" r="1.5" />
          <path d="m4 17 5-5 3.5 3 2.5-2 5 4" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...commonProps}>
          <path d="m4 5 2-2h12l2 2 1 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6l1-8Z" />
          <path d="M3 13h5l2 3h4l2-3h5" />
        </svg>
      );
    case "line":
      return (
        <svg {...commonProps}>
          <path d="M21 11.2c0 4-4 7.3-9 7.3-.8 0-1.5-.1-2.2-.2L5 21l1.2-4.1C4.2 15.6 3 13.6 3 11.2 3 7.2 7 4 12 4s9 3.2 9 7.2Z" />
          <path d="M7 11h.01M12 11h.01M17 11h.01" />
        </svg>
      );
    case "location":
      return (
        <svg {...commonProps}>
          <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case "lock":
      return (
        <svg {...commonProps}>
          <rect x="4" y="10" width="16" height="11" rx="2.5" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          <path d="M12 14v3" />
        </svg>
      );
    case "phone":
      return (
        <svg {...commonProps}>
          <path d="M8 3 5 4.5a2 2 0 0 0-1 2c.8 6.3 5.7 11.2 12 12a2 2 0 0 0 2-1l1.5-3-4-2-1.5 2c-2.2-.8-4.2-2.8-5-5l2-1.5-2-4Z" />
        </svg>
      );
    case "plus":
      return (
        <svg {...commonProps}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "quote":
      return (
        <svg {...commonProps}>
          <path d="M5 3h14a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2Z" />
          <path d="M8 8h8M8 12h5" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...commonProps}>
          <path d="M20 7v5h-5" />
          <path d="M18.5 9A7.5 7.5 0 1 0 19 16" />
        </svg>
      );
    case "route":
      return (
        <svg {...commonProps}>
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="6" r="2" />
          <path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h-1" />
        </svg>
      );
    case "send":
      return (
        <svg {...commonProps}>
          <path d="m22 2-7 20-4-9-9-4 20-7Z" />
          <path d="M22 2 11 13" />
        </svg>
      );
    case "shield":
      return (
        <svg {...commonProps}>
          <path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-3Z" />
          <path d="m8.5 12 2.2 2.2 4.8-5" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...commonProps}>
          <path d="m12 3 1.1 3.1L16 7.5l-2.9 1.4L12 12l-1.1-3.1L8 7.5l2.9-1.4L12 3ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14ZM18 13l1 2.6 2.5 1.2-2.5 1.1-1 2.6-1-2.6-2.5-1.1 2.5-1.2 1-2.6Z" />
        </svg>
      );
    case "user":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case "wrench":
      return (
        <svg {...commonProps}>
          <path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18v3h3l5.3-5.3a5 5 0 0 0 6.4-6.4l-3 3-3-3 3-3Z" />
        </svg>
      );
  }
}

