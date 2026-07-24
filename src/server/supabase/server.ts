import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { readSupabasePublicEnv } from "./env";

const secureCookies = process.env.NODE_ENV === "production";

export async function createSupabaseServerClient() {
  const { url, anonKey } = readSupabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookieOptions: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, {
            ...options,
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: secureCookies,
          });
        }
      },
    },
  });
}
