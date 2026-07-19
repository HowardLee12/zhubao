import { quarantinedNotFoundResponse } from "@/server/supabase/quarantine";

export async function POST(): Promise<Response> {
  return quarantinedNotFoundResponse();
}
