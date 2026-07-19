import { quarantinedNotFoundResponse } from "@/server/supabase/quarantine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return quarantinedNotFoundResponse();
}
