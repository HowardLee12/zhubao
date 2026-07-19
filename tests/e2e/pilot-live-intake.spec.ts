import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";

const mailServerUrl = process.env.PILOT_MAIL_SERVER_URL ?? "http://127.0.0.1:55324";

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#x3D;", "=")
    .replaceAll("&#61;", "=");
}

function findVerificationUrl(value: unknown): string | null {
  const serialized = decodeHtmlEntities(
    typeof value === "string" ? value : JSON.stringify(value),
  );
  const candidates = serialized.match(/https?:\/\/[^\s"'<>\\]+/g) ?? [];

  return (
    candidates.find(
      (candidate) =>
        candidate.includes("/auth/v1/verify") ||
        (candidate.includes("/verify?") && candidate.includes("token=")),
    ) ?? null
  );
}

async function readInbucketMagicLink(
  request: APIRequestContext,
  email: string,
): Promise<string | null> {
  const mailboxUrl = `${mailServerUrl}/api/v1/mailbox/${encodeURIComponent(email)}`;
  const mailboxResponse = await request.get(mailboxUrl);
  if (!mailboxResponse.ok()) return null;

  const messages = (await mailboxResponse.json()) as Array<{ id?: string }>;
  for (const message of messages) {
    if (!message.id) continue;
    const response = await request.get(`${mailboxUrl}/${encodeURIComponent(message.id)}`);
    if (!response.ok()) continue;
    const body = await response.json();
    const verificationUrl = findVerificationUrl(body);
    if (verificationUrl) return verificationUrl;
  }

  return null;
}

async function readMailpitMagicLink(
  request: APIRequestContext,
  email: string,
): Promise<string | null> {
  const query = encodeURIComponent(`to:${email}`);
  const searchResponse = await request.get(
    `${mailServerUrl}/api/v1/search?query=${query}&limit=10`,
  );
  if (!searchResponse.ok()) return null;

  const result = (await searchResponse.json()) as {
    messages?: Array<{ ID?: string; id?: string }>;
  };
  for (const message of result.messages ?? []) {
    const id = message.ID ?? message.id;
    if (!id) continue;
    const response = await request.get(
      `${mailServerUrl}/api/v1/message/${encodeURIComponent(id)}`,
    );
    if (!response.ok()) continue;
    const body = await response.json();
    const verificationUrl = findVerificationUrl(body);
    if (verificationUrl) return verificationUrl;
  }

  return null;
}

async function waitForMagicLink(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  let verificationUrl: string | null = null;

  await expect
    .poll(
      async () => {
        verificationUrl =
          (await readInbucketMagicLink(request, email)) ??
          (await readMailpitMagicLink(request, email));
        return verificationUrl;
      },
      {
        message: `等待 ${email} 的本地 magic link`,
        timeout: 30_000,
        intervals: [250, 500, 1_000],
      },
    )
    .not.toBeNull();

  if (!verificationUrl) throw new Error("本地信箱沒有可用的 magic link");
  return verificationUrl;
}

async function closeContext(context: BrowserContext | undefined) {
  if (context) await context.close();
}

test("new owner can onboard and receive a persisted no-registration intake", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const uniqueSuffix = `${Date.now()}-${testInfo.workerIndex}`;
  const ownerEmail = `pilot-e2e-${uniqueSuffix}@example.test`;
  const organizationName = `E2E 工程行 ${uniqueSuffix}`;
  const organizationSlug = `pilot-e2e-${uniqueSuffix}`;
  const requestTitle = `E2E 浴室漏水 ${uniqueSuffix}`;
  let customerContext: BrowserContext | undefined;

  try {
    await page.goto("/login");
    await page.getByLabel("工作信箱").fill(ownerEmail);
    await page.getByRole("button", { name: "寄送登入連結" }).click();
    await expect(page.getByText("登入連結已寄出，請到信箱完成登入。")).toBeVisible();

    const verificationUrl = await waitForMagicLink(request, ownerEmail);
    await page.goto(verificationUrl);
    await expect(page).toHaveURL(/\/app(?:\/onboarding)?(?:\?.*)?$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "建立你的工作空間" })).toBeVisible();

    await page.getByLabel("店家名稱").fill(organizationName);
    await page.getByLabel("網址代稱").fill(organizationSlug);
    await page.getByLabel("老闆顯示名稱").fill("E2E 老闆");
    await page.getByLabel("主要服務模板").selectOption("cooling");
    await page.getByRole("button", { name: "建立工作空間" }).click();

    await expect(page.getByRole("heading", { name: "工作空間建立完成" })).toBeVisible();
    const publicUrlInput = page.getByLabel("公開報修連結");
    await expect(publicUrlInput).toHaveValue(/^https?:\/\//);
    const publicIntakeUrl = await publicUrlInput.inputValue();

    customerContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
    });
    const customerPage = await customerContext.newPage();
    await customerPage.goto(publicIntakeUrl);
    await expect(customerPage.getByText("不用註冊帳號，送出後店家會直接與你聯絡。"))
      .toBeVisible();

    await customerPage.getByLabel("聯絡人姓名").fill("E2E 林小姐");
    await customerPage.getByLabel("手機號碼").fill("0912345678");
    await customerPage.getByLabel("服務項目").selectOption({ index: 1 });
    await customerPage.getByLabel("需求標題").fill(requestTitle);
    await customerPage
      .getByLabel("問題與需求說明")
      .fill("下雨後牆面有水痕，希望先安排現場確認。這是一筆 Playwright 測試資料。");
    await customerPage.getByLabel("服務地址").fill("台北市松山區民生東路四段 88 號");
    await customerPage.getByRole("checkbox", { name: /我已閱讀並同意/ }).check();
    await customerPage.getByRole("button", { name: "送出需求" }).click();

    await expect(customerPage.getByRole("heading", { name: "需求已送出" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(customerPage.getByText(/SR-|R-/)).toBeVisible();

    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/inbox(?:\?.*)?$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "接案匣" })).toBeVisible();
    await expect(page.getByRole("heading", { name: requestTitle })).toBeVisible();
    await expect(page.getByText("E2E 林小姐")).toBeVisible();
    await expect(page.getByText("台北市松山區民生東路四段 88 號")).toBeVisible();
  } finally {
    await closeContext(customerContext);
  }
});
