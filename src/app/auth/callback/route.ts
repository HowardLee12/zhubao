import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/server/supabase/server";

import { applicationOrigin, safeStaffPath } from "../app-origin";

export const dynamic = "force-dynamic";

function noStoreRedirect(destination: URL): NextResponse {
  const response = NextResponse.redirect(destination);
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("pragma", "no-cache");
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = applicationOrigin(request);
  const code = url.searchParams.get("code");
  const destination = safeStaffPath(url.searchParams.get("next"));

  if (!code) {
    return noStoreRedirect(new URL("/login?error=auth_callback", origin));
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return noStoreRedirect(new URL("/login?error=auth_callback", origin));
    }

    return noStoreRedirect(new URL(destination, origin));
  } catch {
    return noStoreRedirect(new URL("/login?error=auth_callback", origin));
  }
}
