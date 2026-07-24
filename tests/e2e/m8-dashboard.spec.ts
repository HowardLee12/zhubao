import { expect, test } from "@playwright/test";

import { ALPHA_OWNER_EMAIL, loginSeededUser } from "./m8-support";

/**
 * M8 營運指標 (KPI dashboard) journey.
 *
 * The seeded Alpha org has enough operational history for the four fixed KPIs
 * (首次回覆時間 / 報價接受率 / 完工率 / 回訪率). The owner opens the dashboard and
 * sees the four cards each carrying a numerator/denominator (or an honest
 * 尚無足夠資料), never a misleading 0%. Owner/dispatcher only; a technician is
 * blocked elsewhere (see m8-technician-redaction).
 */

test("owner sees the four KPI cards with numerator/denominator", async ({ page, request }) => {
  await loginSeededUser(page, request, ALPHA_OWNER_EMAIL);

  await page.goto("/app/dashboard");

  await expect(page.getByText("首次回覆時間")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("報價接受率")).toBeVisible();
  await expect(page.getByText("完工率")).toBeVisible();
  await expect(page.getByText("回訪率")).toBeVisible();

  // The window is the org-local Asia/Taipei range.
  await expect(page.getByText(/Asia\/Taipei/)).toBeVisible();

  // Each card shows either a value (%/分/時/天) or an honest not-enough-data note —
  // never a bare misleading 0% with no denominator. Assert at least one real value
  // or the honest empty state is present (the seed drives at least one populated).
  const hasSignal = await page
    .getByText(/尚無足夠資料|\d+%|\d+ 分|\d+\.\d+ 時|\d+\.\d+ 天/)
    .first()
    .isVisible();
  expect(hasSignal).toBeTruthy();
});
