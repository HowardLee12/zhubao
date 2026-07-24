import { quarantinedNotFoundResponse } from "@/server/supabase/quarantine";

export async function GET(): Promise<Response> {
  return quarantinedNotFoundResponse();
}

export async function POST(): Promise<Response> {
  return quarantinedNotFoundResponse();
}
