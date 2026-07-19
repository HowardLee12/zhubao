import { expect, type Page } from "@playwright/test";

export class DemoPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto("/demo");
    await expect(this.page.getByText("互動原型 · 示範資料")).toBeVisible();
  }

  async openCurrentIntake() {
    await expect(this.page.getByRole("heading", { name: "接案匣" })).toBeVisible();
    await this.page.getByRole("button", { name: "整理這筆進件" }).click();
  }

  async approveAndAcceptQuote() {
    await this.page.getByRole("button", { name: "建立報價" }).click();
    await expect(this.page.getByRole("heading", { name: "報價人工確認" })).toBeVisible();

    await this.page.getByRole("button", { name: "核准並送出報價" }).click();
    await expect(this.page.getByText("請先勾選人工確認，再送出報價。")).toBeVisible();

    await this.page
      .getByRole("checkbox", { name: /我已檢查價格、範圍、效期與客戶版內容/ })
      .check();
    await this.page.getByRole("button", { name: "核准並送出報價" }).click();
    await expect(this.page.getByText("等待客戶確認", { exact: true })).toBeVisible();

    await this.page.getByRole("button", { name: "模擬客戶接受" }).click();
    await expect(this.page.getByRole("heading", { name: "安排工單" })).toBeVisible();
  }

  async dispatchToAvailableTechnician() {
    await this.page.getByRole("radio", { name: /陳師傅/ }).click();
    await expect(this.page.getByText("此時段沒有衝突，可以派工")).toBeVisible();
    await this.page.getByRole("button", { name: "確認派工並切換技師模式" }).click();
    await expect(this.page.getByRole("heading", { name: "技師現場" })).toBeVisible();
  }

  async advanceVisitToCompletionGate() {
    for (const action of ["開始出發", "我已到場", "開始施工", "送出待確認"]) {
      await this.page.getByRole("button", { name: action }).click();
    }
    await expect(this.page.getByRole("heading", { name: "完工前確認" })).toBeVisible();
  }

  async completeEvidence() {
    await this.page.getByRole("button", { name: "確認完工" }).click();
    await expect(this.page.getByText(/還缺 5 項完工紀錄/)).toBeVisible();

    for (const checkbox of await this.page.getByRole("checkbox").all()) {
      await checkbox.check();
    }
    await this.page.getByRole("button", { name: "加入施工前示範照" }).click();
    await this.page.getByRole("button", { name: "加入施工後示範照" }).click();
    await expect(this.page.getByText("必要紀錄已齊全，可以安全完工")).toBeVisible();

    await this.page.getByRole("button", { name: "確認完工" }).click();
    await expect(this.page.getByRole("heading", { name: "完工摘要" })).toBeVisible();
    await expect(this.page.getByText("流程完成")).toBeVisible();
  }
}
