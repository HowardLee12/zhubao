import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BottomNav } from "@/components/bottom-nav";
import { LiffProvider } from "@/components/liff-provider";
import { AuthGuard } from "@/components/auth-guard";

export const metadata: Metadata = {
  title: "裝潢工程管理系統",
  description: "LINE 整合的裝潢工程管理平台 — 報價、排程、收款、照片一站搞定",
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
        <LiffProvider>
          <AuthGuard>
            <main className="pb-20">
              {children}
            </main>
            <BottomNav />
          </AuthGuard>
        </LiffProvider>
      </body>
    </html>
  );
}
