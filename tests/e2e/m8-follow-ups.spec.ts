import { expect, test } from "@playwright/test";

import {
  ALPHA_ORG,
  ALPHA_OWNER_EMAIL,
  loginSeededUser,
  makeSeededPlanDueToday,
  serviceRoleClient,
} from "./m8-support";

/**
 * M8 回訪 journey (UI convert-to-revisit).
 *
 * A due maintenance plan appears on the 本週到期 tab. The owner prepares an
 * approval-pending revisit reminder DRAFT (it never auto-sends — staff approval is
 * a separate gate, covered end-to-end by the m8-operations integration suite) and
 * then converts the plan into a new service_request (source=revisit) with one
 * click, reusing M2/M3 intake and carrying the origin plan linkage.
 *
 * The scan→approve→claim path is intentionally exercised by the integration suite
 * (it needs an active LINE channel + friend recipient); this E2E owns the UI flow.
 */

test("due plan → prepare reminder draft → convert to a revisit case", async ({ page, request }) => {
  const admin = serviceRoleClient();
  const { planId, nameFragment } = makeSeededPlanDueToday();

  await loginSeededUser(page, request, ALPHA_OWNER_EMAIL);

  await page.goto("/app/follow-ups");
  await expect(page.getByRole("heading", { name: "保養回訪" })).toBeVisible({ timeout: 20_000 });

  // The now-due plan is on the 本週到期 tab.
  const planCard = page.locator("li", { hasText: nameFragment }).first();
  await expect(planCard).toBeVisible({ timeout: 20_000 });

  // Prepare a revisit reminder DRAFT — it is only ever a draft (never auto-sends).
  await planCard.getByRole("button", { name: "準備回訪提醒" }).click();
  await expect(page.getByText(/已準備 \d+ 筆回訪提醒草稿/)).toBeVisible({ timeout: 20_000 });

  // Any reminder that WAS enqueued lands held as approval_status=pending, never sent.
  const drafts = await admin
    .schema("public")
    .from("notifications")
    .select("approval_status, status")
    .eq("organization_id", ALPHA_ORG)
    .eq("template_key", "maintenance_reminder");
  for (const row of (drafts.data ?? []) as Array<{ approval_status: string; status: string }>) {
    expect(["pending", "approved"]).toContain(row.approval_status);
    expect(row.status).not.toBe("sent");
  }

  // Convert the plan into a new case. The seeded plan's asset already has an open
  // request, so convert surfaces the honest forced-confirm dialog first (no silent
  // auto-create); confirm it. If a future seed removes the open request the success
  // notice appears directly, so wait for whichever resolves.
  await planCard.getByRole("button", { name: "轉成新案件" }).click();
  const forced = page.getByRole("button", { name: "仍要建立新案件" });
  const success = page.getByText(/已建立新案件/);
  await expect(forced.or(success)).toBeVisible({ timeout: 20_000 });
  if (await forced.isVisible()) {
    await forced.click();
  }
  await expect(success).toBeVisible({ timeout: 20_000 });

  // A revisit service_request now exists carrying the origin plan linkage.
  const sr = await admin
    .schema("public")
    .from("service_requests")
    .select("source, origin_maintenance_plan_id")
    .eq("origin_maintenance_plan_id", planId)
    .limit(1)
    .maybeSingle();
  expect(sr.data, "a revisit request should link back to the plan").not.toBeNull();
  expect((sr.data as { source: string }).source).toBe("revisit");
});
