import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Renoly — 裝修小隊的接案管家",
  description: "報價、排程、收款、工地照片一站搞定。雙版本報價自動算利潤，LINE 一鍵分享給屋主。",
  metadataBase: new URL("https://zhubao.vercel.app"),
  openGraph: {
    title: "Renoly — 裝修小隊的接案管家",
    description: "報價單、工班排程、收款追蹤、施工照片一站搞定。免費試用！",
    url: "https://zhubao.vercel.app",
    siteName: "Renoly",
    locale: "zh_TW",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
