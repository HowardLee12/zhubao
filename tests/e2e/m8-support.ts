import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { execLocalSql, resolveLocalSupabaseEnv } from "../integration/local-supabase-env";
import { waitForMagicLink } from "./m5-support";

/**
 * M8 E2E plumbing. The M8 dashboards/payments/follow-ups surfaces read pre-seeded
 * operational data (a project with payment milestones, an asset, a maintenance
 * plan) that a freshly-onboarded org does not have. So these journeys log in as the
 * SEEDED Alpha owner/technician via the real local magic-link flow (the seeded
 * users are genuine auth users), then drive the real UI + workers.
 *
 * The seeded ids mirror supabase/seed.sql and the M8 integration suite.
 */

export const ALPHA_OWNER_EMAIL = "alpha.owner@example.test";
export const ALPHA_TECH_EMAIL = "alpha.tech-a@example.test";

export const ALPHA_ORG = "20000000-0000-4000-8000-000000000001";
export const ALPHA_PLAN = "88000000-0000-4000-8000-000000000001";
export const ALPHA_PENDING_MILESTONE = "87000000-0000-4000-8000-000000000001";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`M8 E2E requires ${name} in the environment.`);
  return value;
}

export function serviceRoleClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Log in as a seeded user through the real magic-link flow and land on /app.
export async function loginSeededUser(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("工作信箱").fill(email);
  await page.getByRole("button", { name: "寄送登入連結" }).click();
  await expect(page.getByText("登入連結已寄出，請到信箱完成登入。")).toBeVisible();

  const verificationUrl = await waitForMagicLink(request, email);
  await page.goto(verificationUrl);
  await page.waitForURL(/\/app(?:\/.*)?$/, { timeout: 20_000 });
}

function todayLocalDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

// Make the seeded Alpha maintenance plan due TODAY so the follow-ups 本週到期 tab and
// the scan worker both act on it deterministically. The create/patch RPCs are
// membership-gated and REVOKE service_role, so — exactly as the M8 integration suite
// does for fixture setup — we bypass the status-transition trigger with a superuser
// psql session (session_replication_role = replica) purely to move next_due_on. This
// touches only the seeded plan; the DB is reset before the E2E run. Returns the plan
// id + a stable name fragment the UI renders.
// Reset the seeded Alpha milestone to a clean pending state so each Playwright
// project (mobile + desktop share one DB) starts the payments journey fresh. The
// status-transition guard trigger blocks a plain status UPDATE, so we bypass it
// with a superuser session exactly as the M8 integration fixture reset does.
export function resetSeededMilestoneToPending(): void {
  const env = resolveLocalSupabaseEnv();
  execLocalSql(
    env.dbUrl,
    `set session_replication_role = replica; ` +
      `update public.payment_milestones set status='pending', invoiced_at=null, ` +
      `paid_at=null, payment_method=null, external_reference=null, ` +
      `lock_version=lock_version+1 where id='${ALPHA_PENDING_MILESTONE}'; ` +
      `set session_replication_role = origin;`,
  );
}

export function makeSeededPlanDueToday(): { planId: string; nameFragment: string } {
  const env = resolveLocalSupabaseEnv();
  const nameFragment = "冷氣";
  // Move the seeded plan's due date to today and clear any reminder draft from a
  // prior project run so the scan re-enqueues deterministically (the dedupe_key
  // would otherwise skip it on the second Playwright project sharing this DB).
  execLocalSql(
    env.dbUrl,
    `set session_replication_role = replica; ` +
      `update public.maintenance_plans set status='active', ` +
      `next_due_on='${todayLocalDate()}', lock_version=lock_version+1 ` +
      `where id='${ALPHA_PLAN}'; ` +
      `delete from public.notifications where organization_id='${ALPHA_ORG}' ` +
      `and template_key='maintenance_reminder'; ` +
      // Restore the plan customer's contact + LINE recipient. A prior suite (the
      // data-deletion integration test) anonymizes this seeded customer (name→已刪除,
      // phone/email→NULL) and can block the identity; convert needs a contact method
      // and the scan skips a blocked recipient. Restore to a usable seeded state.
      `update public.customers set name='示範客戶甲', phone='+886912345001', ` +
      `email='customer.alpha@example.test' ` +
      `where id='40000000-0000-4000-8000-000000000001'; ` +
      `update public.customer_line_identities set friend_status='friend' ` +
      `where customer_id='40000000-0000-4000-8000-000000000001'; ` +
      `set session_replication_role = origin;`,
  );
  return { planId: ALPHA_PLAN, nameFragment };
}
