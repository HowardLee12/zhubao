import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// IMPORTANT: every Supabase access in this app is server-side (verified:
// no "use client" component imports this module). Authorization is enforced
// in the app layer via getUserId() + .eq("user_id", ...) ownership filters.
//
// We therefore use the service_role key for ALL DB access so that database
// RLS can be locked to "deny anon" — the public NEXT_PUBLIC anon key (which
// is extractable from client JS) then grants ZERO direct table access.
// service_role bypasses RLS, so server flows are unaffected.
//
// If SUPABASE_SERVICE_ROLE_KEY is missing we fall back to the anon client so
// local/dev without the secret still works — but in that mode the RLS
// lockdown migration must NOT be applied or the app breaks. Production MUST
// have SUPABASE_SERVICE_ROLE_KEY set.
const serverClient = serviceRoleKey
  ? createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : createClient(url, anonKey);

export const supabase = serverClient;
export const supabaseAdmin = serverClient;

// Whether we're really running on service_role (used by a diagnostics check
// so we can confirm before applying the RLS lockdown).
export const usingServiceRole = Boolean(serviceRoleKey);
