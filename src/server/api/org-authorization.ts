import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiProblem } from "@/server/api/problem";
import { authenticationRequiredProblem } from "@/server/supabase/http";

const MANAGER_ROLES = ["owner", "admin", "dispatcher"] as const;

export interface AuthorizedManager {
  userId: string;
}

function forbiddenProblem(): ApiProblem {
  return new ApiProblem({
    status: 403,
    code: "FORBIDDEN",
    title: "沒有權限",
    detail: "你沒有權限查看這個店家的資料。",
  });
}

// Authenticates the caller against their session client and authorizes them as a
// manager (owner/admin/dispatcher) via has_org_role. Domain data is then accessed
// through dedicated authenticated RPCs; no ordinary route falls back to a
// service-role table read. Returns the user id and maps missing/insufficient
// membership to 401/403 before the domain RPC runs.
export async function authorizeOrgManager(
  supabase: Pick<SupabaseClient, "auth" | "rpc">,
  organizationId: string,
): Promise<AuthorizedManager> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) throw authenticationRequiredProblem();

  const { data, error } = await supabase.rpc("has_org_role", {
    target_org: organizationId,
    allowed_roles: [...MANAGER_ROLES],
  });
  if (error) throw forbiddenProblem();
  if (data !== true) throw forbiddenProblem();

  return { userId: user.id };
}
