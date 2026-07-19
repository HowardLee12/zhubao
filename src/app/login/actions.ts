"use server";

import { z } from "zod";

import { createSupabaseServerClient } from "@/server/supabase/server";

import { applicationOrigin, safeStaffPath } from "../auth/app-origin";

const loginEmailSchema = z.string().trim().toLowerCase().email().max(254);
const nextSchema = z.string().max(2048).nullable().catch(null);

export type LoginState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message?: string };

export async function requestMagicLink(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsedEmail = loginEmailSchema.safeParse(formData.get("email"));
  if (!parsedEmail.success) {
    return { status: "error", message: "請輸入有效的電子郵件地址。" };
  }

  const rawNext = formData.get("next");
  const nextCandidate = nextSchema.parse(
    typeof rawNext === "string" ? rawNext : null,
  );
  const safeNext = safeStaffPath(nextCandidate);

  try {
    const supabase = await createSupabaseServerClient();
    const redirectUrl = new URL("/auth/callback", applicationOrigin());
    redirectUrl.searchParams.set("next", safeNext);

    const { error } = await supabase.auth.signInWithOtp({
      email: parsedEmail.data,
      options: {
        emailRedirectTo: redirectUrl.toString(),
        shouldCreateUser: true,
      },
    });

    if (error) {
      return {
        status: "error",
        message: "登入連結暫時無法寄出，請稍後再試。",
      };
    }

    return {
      status: "success",
      message: "登入連結已寄出，請到信箱完成登入。",
    };
  } catch {
    return {
      status: "error",
      message: "登入連結暫時無法寄出，請稍後再試。",
    };
  }
}
