import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { readSupabasePublicEnv } from "./env";

interface PendingCookie {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

function isStaffPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function applyAuthWrites(
  response: NextResponse,
  pendingCookies: PendingCookie[],
  pendingHeaders: Map<string, string>,
): NextResponse {
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, {
      ...options,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  for (const [name, value] of pendingHeaders) {
    response.headers.set(name, value);
  }
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("pragma", "no-cache");
  return response;
}

export async function updateSupabaseSession(
  request: NextRequest,
): Promise<NextResponse> {
  const { url, anonKey } = readSupabasePublicEnv();
  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders = new Map<string, string>();
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
          pendingCookies.push({
            name: cookie.name,
            value: cookie.value,
            options: cookie.options,
          });
        }
        for (const [name, value] of Object.entries(headers)) {
          pendingHeaders.set(name, value);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  if (!user && isStaffPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return applyAuthWrites(
      NextResponse.redirect(loginUrl),
      pendingCookies,
      pendingHeaders,
    );
  }

  if (user && pathname === "/login") {
    return applyAuthWrites(
      NextResponse.redirect(new URL("/app", request.url)),
      pendingCookies,
      pendingHeaders,
    );
  }

  return applyAuthWrites(
    NextResponse.next({ request }),
    pendingCookies,
    pendingHeaders,
  );
}
