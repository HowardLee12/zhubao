import { expect, test, type BrowserContext } from "@playwright/test";

import { createConvertedWorkOrder } from "./m5-support";

/**
 * M5 dispatcher scheduling journey.
 *
 * A fresh owner onboards, an intake is converted into a draft work order, then
 * the owner (acting as dispatcher) schedules a window and assigns themselves as
 * lead. The scheduled work order then appears on the schedule board and — because
 * the owner is the sole assignee — in "my work orders", proving the technician
 * only-own projection surfaces exactly what is assigned.
 */

function nextWeekLocal(offsetHours: number): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(9 + offsetHours, 0, 0, 0);
  // datetime-local expects "YYYY-MM-DDTHH:mm" in local time.
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

test("dispatcher schedules + assigns a work order and it surfaces to the assignee", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const uniqueSuffix = `${Date.now()}-${testInfo.workerIndex}`;
  let closeCustomer: (() => Promise<void>) | undefined;
  let extraContext: BrowserContext | undefined;

  try {
    const { workOrderId, closeCustomer: close } = await createConvertedWorkOrder(
      page,
      request,
      () => browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" }),
      {
        ownerEmail: `pilot-m5d-${uniqueSuffix}@example.test`,
        organizationName: `E2E 排程冷氣行 ${uniqueSuffix}`,
        organizationSlug: `pilot-m5d-${uniqueSuffix}`,
        requestTitle: `E2E 冷氣清洗排程 ${uniqueSuffix}`,
      },
    );
    closeCustomer = close;

    // Land on the work-order workspace and open the schedule sheet.
    await page.goto(`/app/work-orders/${workOrderId}`);
    await expect(page.getByRole("heading", { name: /E2E 冷氣清洗排程/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("待排程", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "排程並指派" }).click();
    await expect(page.getByRole("heading", { name: "排程與指派" })).toBeVisible();

    // Fill the window (next week, a 2h slot).
    await page.getByLabel("開始時間").fill(nextWeekLocal(0));
    await page.getByLabel("結束時間").fill(nextWeekLocal(2));

    // Load the roster and assign the owner as lead.
    await page.getByRole("button", { name: "載入可指派師傅" }).click();
    await page.getByRole("checkbox", { name: /E2E 老闆/ }).check();
    await expect(page.getByText("主責")).toBeVisible();

    // Honest LINE status is surfaced, never a fake "sent".
    await expect(page.getByText(/通知尚未自動發送/)).toBeVisible();

    await page.getByRole("button", { name: "確認排程" }).click();
    await expect(page.getByText(/已排程並派工/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("已排程", { exact: true }).first()).toBeVisible();

    // The scheduled work order now appears on the dispatcher schedule board.
    await page.goto("/app/schedule");
    await expect(page.getByText(/排程與派工通知尚未自動發送/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/E2E 冷氣清洗排程/).first()).toBeVisible();

    // And because the owner is the sole assignee, it appears in "my work orders".
    await page.goto("/app/my-work-orders");
    await expect(page.getByRole("tab", { name: "待執行" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("tab", { name: "待執行" }).click();
    await expect(page.getByText(/E2E 冷氣清洗排程/).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    if (closeCustomer) await closeCustomer();
    if (extraContext) await extraContext.close();
  }
});
