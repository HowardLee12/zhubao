import { expect, test } from "@playwright/test";

import {
  ALPHA_OWNER_EMAIL,
  loginSeededUser,
  resetSeededMilestoneToPending,
} from "./m8-support";

/**
 * M8 收款 journey (tracking only, no payment gateway).
 *
 * The seeded Alpha org owns a project with a PENDING payment milestone (第一期款,
 * NT$2,500,000). The owner logs in, opens 收款, invoices it (待請款 → 已請款) and
 * then records payment (已請款 → 已收款). The 部分付款 tab shows an honest
 * not-supported empty state. Amounts are visible to the owner (a financial role).
 *
 * The DB is reset before the E2E run, so the seeded milestone is a fresh pending.
 */

test("owner invoices then records payment on the seeded milestone; partial-pay is honest-empty", async ({
  page,
  request,
}) => {
  resetSeededMilestoneToPending();
  await loginSeededUser(page, request, ALPHA_OWNER_EMAIL);

  await page.goto("/app/payments");
  await expect(page.getByRole("heading", { name: "收款款項" })).toBeVisible({ timeout: 20_000 });

  // 待請款 tab (default): the seeded milestone with its amount and an invoice action.
  const pendingCard = page.locator("li", { hasText: "第一期款" });
  await expect(pendingCard).toBeVisible({ timeout: 20_000 });
  await expect(pendingCard.getByText("$2,500,000")).toBeVisible();
  await pendingCard.getByRole("button", { name: "建立請款" }).click();

  // It moves to 已請款; switch tab and record payment.
  await page.getByRole("tab", { name: "已請款" }).click();
  const invoicedCard = page.locator("li", { hasText: "第一期款" });
  await expect(invoicedCard).toBeVisible({ timeout: 20_000 });
  await invoicedCard.getByRole("button", { name: "記錄收款" }).click();

  // It moves to 已收款.
  await page.getByRole("tab", { name: "已收款" }).click();
  await expect(page.locator("li", { hasText: "第一期款" })).toBeVisible({ timeout: 20_000 });

  // 部分付款 is an honest not-supported empty state (partial pay is OUT of scope).
  await page.getByRole("tab", { name: "部分付款" }).click();
  await expect(page.getByText(/尚未支援分批收款/)).toBeVisible();
});
