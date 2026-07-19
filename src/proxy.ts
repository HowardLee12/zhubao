import type { NextRequest } from "next/server";

import { updateSupabaseSession } from "@/server/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: ["/app/:path*", "/login", "/auth/callback"],
};
