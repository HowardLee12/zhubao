import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "築報工程管理",
  description: "裝潢設計師的報價、排程、收款、施工照片管理工具。雙版本報價自動算利潤，LINE 一鍵分享給屋主。",
  metadataBase: new URL("https://zhubao.vercel.app"),
  openGraph: {
    title: "築報工程管理 — 裝潢設計師的最佳工具",
    description: "報價單、工班排程、收款追蹤、施工照片一站搞定。免費試用！",
    url: "https://zhubao.vercel.app",
    siteName: "築報",
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
      <body className="antialiased bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
