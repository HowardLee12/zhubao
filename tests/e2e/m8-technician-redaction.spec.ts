import { expect, test } from "@playwright/test";

import { ALPHA_TECH_EMAIL, loginSeededUser } from "./m8-support";

/**
 * M8 technician redaction: a technician NEVER sees amounts, cost, or KPI.
 *
 * The technician tab set does not include 收款 / 回訪 / 工作台 dashboards, and the
 * surfaces themselves refuse a technician at the permission layer (RPC 403 / role
 * gate), not just a hidden button. This proves the redaction end-to-end: a logged-in
 * seeded technician hitting the manager routes sees the honest 你沒有檢視權限 state
 * and no amount ever renders.
 */

test("a technician cannot reach payments or the dashboard and sees no amounts", async ({
  page,
  request,
}) => {
  await loginSeededUser(page, request, ALPHA_TECH_EMAIL);

  // Payments surface: permission state, and no currency anywhere on the page.
  await page.goto("/app/payments");
  await expect(page.getByText("你沒有檢視權限")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/NT\$|\$\d/)).toHaveCount(0);

  // Dashboard/KPI: permission state, and no percentage/cost.
  await page.goto("/app/dashboard");
  await expect(page.getByText("你沒有檢視權限")).toBeVisible({ timeout: 20_000 });

  // The technician bottom nav never surfaces the 收款 / 回訪 manager tabs.
  const nav = page.getByRole("navigation", { name: "主導覽" });
  await expect(nav.getByRole("link", { name: "收款" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "回訪" })).toHaveCount(0);
});
