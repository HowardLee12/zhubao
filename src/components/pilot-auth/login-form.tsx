"use client";

import { useActionState } from "react";

import {
  requestMagicLink,
  type LoginState,
} from "@/app/login/actions";

const initialState: LoginState = { status: "idle" };

export function LoginForm({ next }: Readonly<{ next?: string }>) {
  const [state, formAction, isPending] = useActionState(
    requestMagicLink,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-semibold text-ink">
          工作信箱
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="owner@example.com"
          className="w-full rounded-xl border border-warm-border-strong bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/20"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-xl bg-orange px-4 py-3.5 text-sm font-bold text-white transition hover:bg-orange-deep disabled:cursor-wait disabled:opacity-60"
      >
        {isPending ? "寄送中…" : "寄送登入連結"}
      </button>

      <p
        aria-live="polite"
        className={`min-h-6 text-sm ${
          state.status === "success" ? "text-success" : "text-destructive"
        }`}
      >
        {state.status === "idle" ? "" : state.message}
      </p>
    </form>
  );
}
