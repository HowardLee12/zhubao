import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "@/components/pilot-auth/login-form";

export const metadata: Metadata = {
  title: "登入工作台 — Renoly",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    next?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const callbackFailed = params.error === "auth_callback";
  const requestedNext =
    typeof params.next === "string" && params.next ? params.next : undefined;

  return (
    <main className="min-h-dvh bg-background px-5 py-10">
      <div className="mx-auto max-w-sm">
        <Link href="/" className="text-sm font-bold tracking-wide text-orange">
          Renoly
        </Link>

        <section className="mt-8 rounded-3xl border border-warm-border bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange">
            店家工作台
          </p>
          <h1 className="mt-2 text-2xl font-bold text-ink">登入開始接案</h1>
          <p className="mt-2 text-sm leading-6 text-ink-2">
            我們會寄一封一次性登入連結，不需要記密碼。客戶填報修時不需要登入。
          </p>

          {callbackFailed ? (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-brick-soft px-3 py-2 text-sm text-destructive"
            >
              登入連結無效或已過期，請重新寄送一封。
            </p>
          ) : null}

          <div className="mt-6">
            <LoginForm next={requestedNext} />
          </div>
        </section>

        <p className="mt-5 text-center text-xs leading-5 text-ink-3">
          登入代表你同意只將客戶資料用於接案與服務履行。
        </p>
      </div>
    </main>
  );
}
