"use client";

import { LiffProvider } from "@/components/liff-provider";
import { AuthGuard } from "@/components/auth-guard";
import { BottomNav } from "@/components/bottom-nav";
import { FeedbackButton } from "@/components/feedback-button";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <LiffProvider>
      <AuthGuard>
        <main className="pb-20">
          {children}
        </main>
        <BottomNav />
        <FeedbackButton />
      </AuthGuard>
    </LiffProvider>
  );
}
