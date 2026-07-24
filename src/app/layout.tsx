import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Renoly — 小型工程團隊的接案到完工工作台",
  description: "把 LINE 詢問整理成報價、派工、現場證據、收款與回訪，適合冷氣、水電、抓漏與小型工程團隊。",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "Renoly — 小型工程團隊的接案到完工工作台",
    description: "LINE 進件、人工報價、派工、現場證據、收款與回訪，在同一條可追蹤流程完成。",
    url: siteUrl,
    siteName: "Renoly",
    locale: "zh_TW",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body className="antialiased bg-background text-foreground">{children}</body>
    </html>
  );
}
