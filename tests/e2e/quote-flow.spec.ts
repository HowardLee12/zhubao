import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const mailServerUrl = process.env.PILOT_MAIL_SERVER_URL ?? "http://127.0.0.1:55324";

function verificationUrl(value: unknown): string | null {
  const serialized = (typeof value === "string" ? value : JSON.stringify(value))
    .replaceAll("&amp;", "&")
    .replaceAll("&#x3D;", "=")
    .replaceAll("&#61;", "=");
  return (
    (serialized.match(/https?:\/\/[^\s"'<>\\]+/g) ?? []).find(
      (candidate) =>
        candidate.includes("/auth/v1/verify") ||
        (candidate.includes("/verify?") && candidate.includes("token=")),
    ) ?? null
  );
}

async function readMagicLink(request: APIRequestContext, email: string): Promise<string | null> {
  const mailboxUrl = `${mailServerUrl}/api/v1/mailbox/${encodeURIComponent(email)}`;
  const mailbox = await request.get(mailboxUrl);
  if (mailbox.ok()) {
    const messages = (await mailbox.json()) as Array<{ id?: string }>;
    for (const message of messages) {
      if (!message.id) continue;
      const response = await request.get(`${mailboxUrl}/${encodeURIComponent(message.id)}`);
      if (!response.ok()) continue;
      const found = verificationUrl(await response.json());
      if (found) return found;
    }
  }

  const search = await request.get(
    `${mailServerUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=10`,
  );
  if (!search.ok()) return null;
  const result = (await search.json()) as { messages?: Array<{ ID?: string; id?: string }> };
  for (const message of result.messages ?? []) {
    const id = message.ID ?? message.id;
    if (!id) continue;
    const response = await request.get(`${mailServerUrl}/api/v1/message/${encodeURIComponent(id)}`);
    if (!response.ok()) continue;
    const found = verificationUrl(await response.json());
    if (found) return found;
  }
  return null;
}

async function waitForMagicLink(request: APIRequestContext, email: string): Promise<string> {
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        link = await readMagicLink(request, email);
        return link;
      },
      { timeout: 30_000, intervals: [250, 500, 1_000] },
    )
    .not.toBeNull();
  if (!link) throw new Error("本地信箱沒有可用的 magic link");
  return link;
}

async function onboard(page: Page, request: APIRequestContext, suffix: string): Promise<string> {
  const email = `pilot-quote-${suffix}@example.test`;
  await page.goto("/login");
  await page.getByLabel("工作信箱").fill(email);
  await page.getByRole("button", { name: "寄送登入連結" }).click();
  await page.goto(await waitForMagicLink(request, email));
  await expect(page.getByRole("heading", { name: "建立你的工作空間" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByLabel("店家名稱").fill(`E2E 報價工程行 ${suffix}`);
  await page.getByLabel("網址代稱").fill(`pilot-quote-${suffix}`);
  await page.getByLabel("老闆顯示名稱").fill("E2E 老闆");
  await page.getByLabel("主要服務模板").selectOption("cooling");
  await page.getByRole("button", { name: "建立工作空間" }).click();
  const intakeLink = page.getByLabel("公開報修連結");
  await expect(intakeLink).toHaveValue(/^https?:\/\//);
  return intakeLink.inputValue();
}

async function submitCustomerRequest(page: Page, intakeUrl: string, title: string) {
  await page.goto(intakeUrl);
  await page.getByLabel("聯絡人姓名").fill("E2E 林太太");
  await page.getByLabel("手機號碼").fill("0912345678");
  await page.getByLabel("服務項目").selectOption({ index: 1 });
  await page.getByLabel("需求標題").fill(title);
  await page.getByLabel("問題與需求說明").fill("客廳與主臥兩台冷氣需要清洗。Playwright 測試資料。");
  await page.getByLabel("服務地址").fill("台北市松山區民生東路四段 88 號");
  await page.getByRole("checkbox", { name: /我已閱讀並同意/ }).check();
  await page.getByRole("button", { name: "送出需求" }).click();
  await expect(page.getByRole("heading", { name: "需求已送出" })).toBeVisible({
    timeout: 20_000,
  });
}

test("owner sends an immutable quote and customer accepts before conversion", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const title = `E2E 冷氣正式報價 ${suffix}`;
  let customerContext: BrowserContext | undefined;

  try {
    const intakeUrl = await onboard(page, request, suffix);
    customerContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
    const customerPage = await customerContext.newPage();
    await submitCustomerRequest(customerPage, intakeUrl, title);

    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/inbox/, { timeout: 20_000 });
    await page.getByRole("link", { name: "查看並整理進件" }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByLabel("服務類別").selectOption("cooling");
    await page.getByRole("button", { name: "分流案件" }).click();
    await expect(page.getByText("案件已分流。")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("link", { name: "建立／查看正式報價" }).click();
    await expect(page).toHaveURL(/\/app\/inbox\/[0-9a-f-]+\/quote$/);
    await expect(page.getByRole("heading", { name: "報價工作區" })).toBeVisible();
    await page.getByLabel("品項 1 數量").fill("2.000");
    await page.getByLabel("品項 1 客戶單價").fill("2500");
    await page.getByLabel("品項 1 內部成本").fill("1200");
    await page.getByRole("button", { name: "建立並儲存草稿" }).click();
    await expect(page.getByText(/重新整理也不會消失/)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/app\/quotes\/[0-9a-f-]+$/);

    const approve = page.getByRole("checkbox", { name: /我已檢查價格/ });
    await approve.check();
    await page.getByRole("button", { name: "核准並建立分享連結" }).click();
    await expect(page.getByText("客戶安全連結已建立")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/尚未接 LINE 自動通知/)).toBeVisible();
    const publicQuoteUrl = await page.getByLabel("客戶報價連結").inputValue();
    expect(publicQuoteUrl).toMatch(/\/public\/quotes#[A-Za-z0-9_-]{43}$/);

    await customerPage.goto(publicQuoteUrl);
    await expect(customerPage.getByRole("heading", { name: `${title}報價` })).toBeVisible();
    await expect(customerPage.getByText(/不需註冊帳號/)).toBeVisible();
    await expect(customerPage.getByText(/內部成本|成本不可/)).toHaveCount(0);
    await customerPage.getByLabel("確認人姓名").fill("E2E 林太太");
    await customerPage.getByLabel("給店家的備註").fill("請安排週六上午");
    await customerPage.getByRole("button", { name: "接受報價" }).click();
    await expect(customerPage.getByRole("dialog")).toContainText("第 1 版");
    await customerPage.getByRole("button", { name: "確認送出" }).click();
    await expect(customerPage.getByText("已接受這份報價")).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByText(/客戶已接受 v1/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: "回到進件並建立案件" }).click();
    await page.getByRole("button", { name: "轉換為案件" }).click();
    await page.getByRole("dialog", { name: "轉換為案件" }).getByRole("button", { name: "確認轉換" }).click();
    await expect(page.getByText("這筆進件已建立案件，無法再次轉換。")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/^(?:WO|PJ)-\d{6}-\d{6}$/).first()).toBeVisible();
  } finally {
    if (customerContext) await customerContext.close();
  }
});
