import { expect, test } from "@playwright/test";

import { DemoPage } from "./pages/demo-page";

test.describe("Renoly v2 concierge vertical slice", () => {
  test("LINE 進件經人工報價、派工與現場證據後才可完工", async ({ page }) => {
    const demo = new DemoPage(page);

    await demo.goto();
    await demo.openCurrentIntake();
    await expect(page.getByRole("heading", { name: /林太太/ })).toBeVisible();
    await demo.approveAndAcceptQuote();
    await demo.dispatchToAvailableTechnician();
    await demo.advanceVisitToCompletionGate();
    await demo.completeEvidence();

    await expect(page.getByText("工單已完成", { exact: true }).first()).toBeVisible();
  });

  test("小型工程模板的追加金額只在客戶接受後納入確認總額", async ({ page }) => {
    const demo = new DemoPage(page);

    await demo.goto();
    await page.getByRole("button", { name: "小型工程" }).click();
    await demo.openCurrentIntake();
    await expect(page.getByRole("heading", { name: /陳先生.*陽台漏水/ })).toBeVisible();

    await expect(page.getByText("草稿・未對客")).toBeVisible();
    await page.getByRole("button", { name: "送出追加簽認" }).click();
    await expect(page.getByText("此版本已鎖定，正在等待客戶回覆")).toBeVisible();

    await page.getByRole("button", { name: "模擬客戶接受追加" }).click();
    await expect(page.getByText("簽認版本、時間與證據已保留")).toBeVisible();
    await expect(page.getByText("NT$ 76,000", { exact: true }).last()).toBeVisible();
  });
});
