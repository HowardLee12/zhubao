import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createAdminSupabaseClient(): SupabaseClient {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

  if (!rawUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  }
  if (!serviceRoleKey || serviceRoleKey.startsWith("replace-with-")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is invalid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTP or HTTPS.");
  }

  return createClient(url.toString().replace(/\/$/, ""), serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
