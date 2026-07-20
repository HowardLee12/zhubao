import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { rateLimitedProblem } from "@/server/api/operations-errors";
import { internalApiProblem } from "@/server/supabase/http";

type Rpc = Pick<SupabaseClient, "rpc">;

const statusSchema = z.enum(["ok", "limited"]);

export type RateLimitAction = "read" | "mutation" | "search_report";

// Consume one unit from the shared authenticated rate-limit window keyed on
// (org, user, action). The limiter runs in its own transaction inside the RPC and
// counts the attempt BEFORE the route does any expensive work — a tripped window
// raises a 429 whose count is NOT rolled back by a later route failure. Read
// 300/min, mutation 120/min, search_report 30/min (security.md §12).
export async function consumeAuthenticatedRateLimit(command: {
  supabase: Rpc;
  organizationId: string;
  userId: string;
  action: RateLimitAction;
}): Promise<void> {
  const { data, error } = await command.supabase.rpc(
    "consume_pilot_authenticated_rate_limit",
    {
      p_organization_id: command.organizationId,
      p_user_id: command.userId,
      p_action: command.action,
    },
  );
  if (error) throw internalApiProblem();
  const status = statusSchema.safeParse(data);
  if (!status.success) throw internalApiProblem();
  if (status.data === "limited") throw rateLimitedProblem();
}
