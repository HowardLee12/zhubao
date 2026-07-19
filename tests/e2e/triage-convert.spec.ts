import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * M3 triage → convert journey (extends the pilot live-intake journey, J03).
 *
 * A new owner onboards, a no-registration customer submits an intake, then the
 * owner opens the request detail and:
 *  - sees the immutable original submission beside the editable structured summary,
 *  - confirms the customer the intake auto-linked (the "link existing / create new"
 *    decision point; intake seeds a provisional customer, so it loads pre-linked),
 *  - triages the request (new → triaged, content preserved through the merge),
 *  - converts it into a work order (template + checklist snapshot on the server),
 *  - sees the persisted case number with convert disabled (without a fake link),
 *  - and on a second convert attempt still lands on the same case (convert-once).
 *
 * The intake half reuses the same local Mailpit/Inbucket magic-link plumbing as
 * pilot-live-intake.spec.ts.
 */

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

async function onboardOwner(
  page: Page,
  request: APIRequestContext,
  params: {
    ownerEmail: string;
    organizationName: string;
    organizationSlug: string;
  },
): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("工作信箱").fill(params.ownerEmail);
  await page.getByRole("button", { name: "寄送登入連結" }).click();
  await expect(page.getByText("登入連結已寄出，請到信箱完成登入。")).toBeVisible();

  const verificationUrl = await waitForMagicLink(request, params.ownerEmail);
  await page.goto(verificationUrl);
  await expect(page).toHaveURL(/\/app(?:\/onboarding)?(?:\?.*)?$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "建立你的工作空間" })).toBeVisible();

  await page.getByLabel("店家名稱").fill(params.organizationName);
  await page.getByLabel("網址代稱").fill(params.organizationSlug);
  await page.getByLabel("老闆顯示名稱").fill("E2E 老闆");
  await page.getByLabel("主要服務模板").selectOption("cooling");
  await page.getByRole("button", { name: "建立工作空間" }).click();

  await expect(page.getByRole("heading", { name: "工作空間建立完成" })).toBeVisible();
  const publicUrlInput = page.getByLabel("公開報修連結");
  await expect(publicUrlInput).toHaveValue(/^https?:\/\//);
  return publicUrlInput.inputValue();
}

async function submitIntake(
  customerPage: Page,
  params: { requestTitle: string; contactName: string; address: string },
): Promise<void> {
  await expect(
    customerPage.getByText("不用註冊帳號，送出後店家會直接與你聯絡。"),
  ).toBeVisible();

  await customerPage.getByLabel("聯絡人姓名").fill(params.contactName);
  await customerPage.getByLabel("手機號碼").fill("0912345678");
  await customerPage.getByLabel("服務項目").selectOption({ index: 1 });
  await customerPage.getByLabel("需求標題").fill(params.requestTitle);
  await customerPage
    .getByLabel("問題與需求說明")
    .fill("下雨後牆面有水痕，希望先安排現場確認。這是一筆 Playwright 測試資料。");
  await customerPage.getByLabel("服務地址").fill(params.address);
  await customerPage.getByRole("checkbox", { name: /我已閱讀並同意/ }).check();
  await customerPage.getByRole("button", { name: "送出需求" }).click();

  await expect(customerPage.getByRole("heading", { name: "需求已送出" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(customerPage.getByText(/SR-|R-/)).toBeVisible();
}

test("owner triages and converts an intake exactly once", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const uniqueSuffix = `${Date.now()}-${testInfo.workerIndex}`;
  const ownerEmail = `pilot-tc-${uniqueSuffix}@example.test`;
  const organizationName = `E2E 分流工程行 ${uniqueSuffix}`;
  const organizationSlug = `pilot-tc-${uniqueSuffix}`;
  const requestTitle = `E2E 浴室漏水分流 ${uniqueSuffix}`;
  const contactName = "E2E 陳先生";
  const address = "台北市信義區松高路 68 號";
  let customerContext: BrowserContext | undefined;

  try {
    const publicIntakeUrl = await onboardOwner(page, request, {
      ownerEmail,
      organizationName,
      organizationSlug,
    });

    // Customer submits a no-registration intake from a fresh context.
    customerContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
    });
    const customerPage = await customerContext.newPage();
    await customerPage.goto(publicIntakeUrl);
    await submitIntake(customerPage, { requestTitle, contactName, address });

    // Owner opens the inbox and drills into the new request.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/inbox(?:\?.*)?$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "接案匣" })).toBeVisible();
    await expect(page.getByRole("heading", { name: requestTitle })).toBeVisible();

    await page.getByRole("link", { name: "查看並整理進件" }).first().click();
    await expect(page).toHaveURL(/\/app\/inbox\/[0-9a-f-]+$/, { timeout: 20_000 });

    // Immutable original submission on the left; editable structured summary right.
    await expect(page.getByRole("heading", { name: /原始需求/ })).toBeVisible();
    await expect(page.getByText("此區塊為送出當下的存證，不可修改。")).toBeVisible();
    await expect(page.getByRole("heading", { name: "整理後摘要" })).toBeVisible();
    const summarySubject = page.getByLabel("主旨");
    await expect(summarySubject).toHaveValue(requestTitle);
    await expect(summarySubject).toBeEditable();

    // The intake seeded a provisional customer, so the detail loads pre-linked —
    // this is the "link existing customer" decision surfaced as an already-linked
    // state. Confirm the linked customer block is present before triaging.
    await expect(page.getByText(/已連結客戶/)).toBeVisible();

    // The real members projection powers the assignment picker. A brand-new
    // organization has one operational member (the owner), so select them and
    // verify the assignment survives triage.
    const assignee = page.getByLabel("指派師傅");
    await expect(assignee.locator("option", { hasText: "E2E 老闆" })).toHaveCount(1);
    await assignee.selectOption({ label: "E2E 老闆" });
    await expect(assignee).toHaveValue(/.+/);

    // Set service type + priority, then triage (new → triaged).
    await page.getByLabel("服務類別").selectOption("waterproofing");
    await page.getByLabel("優先度").selectOption("high");
    await page.getByLabel("內部備註").fill("E2E 已電話確認現場狀況");
    await page.getByRole("button", { name: "分流案件" }).click();
    await expect(page.getByText("案件已分流。")).toBeVisible({ timeout: 15_000 });
    await expect(assignee).toHaveValue(/.+/);

    // Content survives the ActionResult merge (header keeps the subject, not blank).
    await expect(page.getByRole("heading", { name: requestTitle })).toBeVisible();

    // Convert into a single-visit work order.
    await page.getByRole("button", { name: "轉換為案件" }).click();
    const convertDialog = page.getByRole("dialog", { name: "轉換為案件" });
    await expect(convertDialog).toBeVisible();
    await convertDialog.getByRole("button", { name: "確認轉換" }).click();

    // Converted state: persisted case number visible, convert action gone. The
    // work-order workspace is a later milestone, so M3 must not render a dead link.
    await expect(
      page.getByText("這筆進件已建立案件，無法再次轉換。"),
    ).toBeVisible({ timeout: 15_000 });
    const caseNumber = page.getByText(/^(?:WO|PJ)-\d{6}-\d{6}$/).first();
    await expect(caseNumber).toBeVisible();
    const persistedCaseNumber = (await caseNumber.textContent())?.trim();
    expect(persistedCaseNumber).toBeTruthy();
    await expect(page.getByText(/案件工作台.*下一個里程碑/)).toBeVisible();
    await expect(page.getByRole("link", { name: "前往案件" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "轉換為案件" })).toHaveCount(0);

    // Second convert attempt: reload the detail; it must still be the same case,
    // not a new one (convert-once / return-existing). The converted banner and the
    // same converted state is shown, and no convert button is offered.
    await page.reload();
    await expect(
      page.getByText("這筆進件已建立案件，無法再次轉換。"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "前往案件" })).toHaveCount(0);
    await expect(page.getByText(persistedCaseNumber ?? "__missing__", { exact: true })).toBeVisible();
    await expect(page.getByLabel("內部備註")).toHaveValue("E2E 已電話確認現場狀況");
    await expect(page.getByRole("button", { name: "轉換為案件" })).toHaveCount(0);
  } finally {
    await closeContext(customerContext);
  }
});
