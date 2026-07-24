import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ApiProblem } from "@/server/api/problem";
import {
  consumeAuthenticatedRateLimit,
  type RateLimitAction,
} from "@/server/api/authenticated-rate-limit";
import { createAdminSupabaseClient } from "@/server/supabase/admin";
import { authenticationRequiredProblem } from "@/server/supabase/http";

// Authenticate the caller against their session client and consume one unit from
// the authenticated rate-limit window keyed on (org, user, action). Role is
// enforced by the SECURITY DEFINER RPC downstream (RPC-first), so this helper does
// NOT coarse-gate the role — that would wrongly 403 accountants on payment routes
// whose RPCs legitimately allow them. Returns the authenticated user id.
export async function authenticateAndRateLimit(
  supabase: Pick<SupabaseClient, "auth" | "rpc">,
  organizationId: string,
  action: RateLimitAction,
): Promise<{ userId: string }> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw authenticationRequiredProblem();

  // The limiter table is written by a service_role-only RPC (an authenticated user
  // has no grant to it), so consume the window on a service-role admin client while
  // the caller is still identified by their own session above.
  await consumeAuthenticatedRateLimit({
    supabase: createAdminSupabaseClient(),
    organizationId,
    userId: user.id,
    action,
  });

  return { userId: user.id };
}

export function parseUuidParam(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw ApiProblem.fromZod(parsed.error);
  return parsed.data;
}
