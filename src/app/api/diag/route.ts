import { usingServiceRole } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Temporary pre-RLS-lockdown safety check. Returns ONLY a boolean — no data.
// Used to confirm production is really on the service_role key before the
// RLS deny-anon migration is applied. Remove after verification.
export async function GET() {
  return new Response(
    JSON.stringify({ serviceRole: usingServiceRole }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
