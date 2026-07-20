import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiProblem } from "./problem";

/**
 * Provisions (or reuses) the auth-user binding for an invited member's email.
 *
 * The pilot "team" screen collects only an email + name + role; the auth account
 * that lets the new member sign in later (via magic link) is created here with the
 * service-role admin client BEFORE the org membership is written. The flow is
 * idempotent by email:
 *
 *   1. Try to create the user with `email_confirm: true` (no confirmation mail).
 *   2. If the email already has an account (`email_exists` / HTTP 422), look it up
 *      through the admin list endpoint and reuse the existing id.
 *
 * Every failure surfaces as a clean 5xx `ApiProblem`; the service-role key is never
 * placed in the message, so it can never leak to the client.
 */
export async function provisionAuthUserId(
  admin: Pick<SupabaseClient, "auth">,
  email: string,
): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();

  const created = await admin.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
  });

  if (!created.error) {
    const id = created.data?.user?.id;
    if (!id) throw provisioningFailed();
    return id;
  }

  // A pre-existing account is expected (re-inviting someone who once had access
  // elsewhere, or a retried request); anything else is an infrastructure fault.
  const alreadyExists =
    created.error.code === "email_exists" || created.error.status === 422;
  if (!alreadyExists) {
    throw provisioningFailed();
  }

  const existingId = await findUserIdByEmail(admin, normalizedEmail);
  if (!existingId) throw provisioningFailed();
  return existingId;
}

async function findUserIdByEmail(
  admin: Pick<SupabaseClient, "auth">,
  normalizedEmail: string,
): Promise<string | null> {
  // The admin list endpoint has no exact-match filter across GoTrue versions, so
  // page through and compare emails case-insensitively. Bounded to keep a
  // pathological directory from turning one invite into an unbounded scan.
  const maxPages = 20;
  const perPage = 200;

  for (let page = 1; page <= maxPages; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage });
    if (listed.error) throw provisioningFailed();

    const users = listed.data?.users ?? [];
    const match = users.find(
      (candidate) => candidate.email?.toLowerCase() === normalizedEmail,
    );
    if (match) return match.id;

    if (users.length < perPage) break;
  }

  return null;
}

function provisioningFailed(): ApiProblem {
  return new ApiProblem({
    status: 502,
    code: "MEMBER_PROVISIONING_FAILED",
    title: "無法建立登入帳號",
    detail: "系統暫時無法為這位成員建立登入帳號，請稍後再試一次。",
  });
}
