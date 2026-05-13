"use client";

import { useLiff } from "./liff-provider";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { loading, user } = useLiff();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background">
        <div className="text-3xl font-extrabold text-primary mb-2 tracking-tight">Renoly</div>
        <div className="text-sm text-muted-foreground">載入中...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background px-6">
        <div className="text-3xl font-extrabold text-primary mb-2 tracking-tight">Renoly</div>
        <div className="text-sm text-muted-foreground text-center mb-6">
          裝修小隊的接案管家
        </div>
        <div className="bg-card rounded-xl shadow-sm p-6 w-full max-w-sm text-center">
          <div className="text-sm text-sage-700 mb-4">
            請從 LINE 開啟 Renoly
          </div>
          <a
            href={`https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}`}
            className="block w-full bg-[#06C755] text-white py-3 rounded-xl font-semibold text-sm"
          >
            用 LINE 開啟
          </a>
          <div className="text-[11px] text-muted-foreground mt-4">
            首次使用會自動建立帳號
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
