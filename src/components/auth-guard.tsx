"use client";

import { useLiff } from "./liff-provider";

function DebugPanel({ log }: { log: string[] }) {
  if (log.length === 0) return null;
  return (
    <div className="mt-4 w-full max-w-sm bg-gray-900 text-green-400 text-[10px] font-mono p-3 rounded-lg max-h-60 overflow-y-auto">
      <div className="text-yellow-400 mb-1 font-bold">DEBUG LOG</div>
      {log.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { loading, user, debugLog } = useLiff();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background">
        <div className="text-2xl font-bold text-primary mb-2">築報</div>
        <div className="text-sm text-muted-foreground">載入中...</div>
        <DebugPanel log={debugLog} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background px-6">
        <div className="text-2xl font-bold text-primary mb-2">築報</div>
        <div className="text-sm text-muted-foreground text-center mb-6">
          裝潢工程報價與管理工具
        </div>
        <div className="bg-card rounded-xl shadow-sm p-6 w-full max-w-sm text-center">
          <div className="text-sm text-sage-700 mb-4">
            請從 LINE 開啟築報
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
        <DebugPanel log={debugLog} />
      </div>
    );
  }

  return <>{children}</>;
}
