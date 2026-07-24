import { expect, test } from "@playwright/test";

test("新首頁清楚呈現跨產業定位並導向可操作原型", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /LINE 裡的詢問.*變成不漏單的工程流程/ }),
  ).toBeVisible();
  await expect(page.getByText("冷氣是首波模板，不是產品邊界。")).toBeVisible();
  await expect(page.getByText("水電工程", { exact: true })).toBeVisible();
  await expect(page.getByText("抓漏防水", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "查看原型" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByText("互動原型 · 示範資料")).toBeVisible();
});
