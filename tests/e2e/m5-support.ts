import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * Shared M5 E2E plumbing: local magic-link login (reused from the M3/M4 journeys)
 * plus onboarding + intake + convert helpers so each M5 spec can reach a real,
 * server-created work order without DB shortcuts.
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
    const verificationUrl = findVerificationUrl(await response.json());
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
    const verificationUrl = findVerificationUrl(await response.json());
    if (verificationUrl) return verificationUrl;
  }
  return null;
}

export async function waitForMagicLink(
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
      { message: `等待 ${email} 的本地 magic link`, timeout: 30_000, intervals: [250, 500, 1_000] },
    )
    .not.toBeNull();
  if (!verificationUrl) throw new Error("本地信箱沒有可用的 magic link");
  return verificationUrl;
}

export async function closeContext(context: BrowserContext | undefined): Promise<void> {
  if (context) await context.close();
}

export async function onboardOwner(
  page: Page,
  request: APIRequestContext,
  params: { ownerEmail: string; organizationName: string; organizationSlug: string },
): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("工作信箱").fill(params.ownerEmail);
  await page.getByRole("button", { name: "寄送登入連結" }).click();
  await expect(page.getByText("登入連結已寄出，請到信箱完成登入。")).toBeVisible();

  const verificationUrl = await waitForMagicLink(request, params.ownerEmail);
  await page.goto(verificationUrl);
  // A brand-new owner lands on /app (loading) then app-entry redirects to
  // /app/onboarding; wait for that URL before asserting the heading so the
  // redirect chain isn't raced by the default 5s assertion.
  await page.waitForURL(/\/app\/onboarding(?:\?.*)?$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "建立你的工作空間" })).toBeVisible({
    timeout: 20_000,
  });

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

export async function submitIntake(
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
    .fill("冷氣需要清洗，希望安排到府。這是一筆 Playwright 測試資料。");
  await customerPage.getByLabel("服務地址").fill(params.address);
  await customerPage.getByRole("checkbox", { name: /我已閱讀並同意/ }).check();
  await customerPage.getByRole("button", { name: "送出需求" }).click();
  await expect(customerPage.getByRole("heading", { name: "需求已送出" })).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Onboard, submit an intake, triage + convert it to a single-visit work order,
 * and return the work-order id from the workspace link the converted state now
 * surfaces.
 */
export async function createConvertedWorkOrder(
  page: Page,
  request: APIRequestContext,
  browserNewContext: () => Promise<BrowserContext>,
  params: {
    ownerEmail: string;
    organizationName: string;
    organizationSlug: string;
    requestTitle: string;
  },
): Promise<{ workOrderId: string; closeCustomer: () => Promise<void> }> {
  const publicIntakeUrl = await onboardOwner(page, request, params);

  const customerContext = await browserNewContext();
  const customerPage = await customerContext.newPage();
  await customerPage.goto(publicIntakeUrl);
  await submitIntake(customerPage, {
    requestTitle: params.requestTitle,
    contactName: "E2E 陳先生",
    address: "台北市信義區松高路 68 號",
  });

  // /app renders a manager hub (nav cards) rather than auto-redirecting to the
  // inbox; navigate straight to the inbox surface the rest of this flow needs.
  await page.goto("/app/inbox");
  await expect(page).toHaveURL(/\/app\/inbox(?:\?.*)?$/, { timeout: 20_000 });
  await page.getByRole("link", { name: "查看並整理進件" }).first().click();
  await expect(page).toHaveURL(/\/app\/inbox\/[0-9a-f-]+$/, { timeout: 20_000 });

  // Assign the owner to the request so triage keeps an operational owner, then triage.
  const assignee = page.getByLabel("指派師傅");
  await assignee.selectOption({ label: "E2E 老闆" });
  await page.getByRole("button", { name: "分流案件" }).click();
  await expect(page.getByText("案件已分流。")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "轉換為案件" }).click();
  const dialog = page.getByRole("dialog", { name: "轉換為案件" });
  await dialog.getByRole("button", { name: "確認轉換" }).click();

  const workspaceLink = page.getByRole("link", { name: "前往工單工作台" });
  await expect(workspaceLink).toBeVisible({ timeout: 15_000 });
  const href = await workspaceLink.getAttribute("href");
  const workOrderId = href?.split("/").pop() ?? "";
  expect(workOrderId).toMatch(/[0-9a-f-]{36}/);

  return {
    workOrderId,
    closeCustomer: () => closeContext(customerContext),
  };
}
