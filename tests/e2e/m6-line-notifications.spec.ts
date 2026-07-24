import { expect, test } from "@playwright/test";

import { closeContext, onboardOwner } from "./m5-support";

/**
 * M6 LINE connection + outbox journey (fake adapter, no real api.line.me).
 *
 * A fresh owner onboards, opens 店家設定 → LINE 官方帳號, sees the honest 未連接
 * state, then connects a channel by pasting a channel id / secret / token. The
 * credentials are AES-256-GCM encrypted server-side and NEVER returned; the page
 * flips to 已連接. The owner then opens the outbox (通知發送紀錄) and sees its
 * loading→ready lifecycle (empty state for a brand-new org). This drives the two
 * staff M6 surfaces end-to-end against the real server + local Supabase with the
 * fake LINE messenger — the real channel push stays deferred behind the seam.
 */

test("owner connects a LINE channel and reaches the outbox view", async ({
  page,
  request,
}, testInfo) => {
  const uniqueSuffix = `${Date.now()}-${testInfo.workerIndex}`;

  try {
    await onboardOwner(page, request, {
      ownerEmail: `pilot-m6-${uniqueSuffix}@example.test`,
      organizationName: `E2E LINE 冷氣行 ${uniqueSuffix}`,
      organizationSlug: `pilot-m6-${uniqueSuffix}`,
    });

    // Settings → LINE channel: the honest 未連接 state first.
    await page.goto("/app/settings/line-channel");
    await expect(page.getByText("LINE 未連接")).toBeVisible({ timeout: 20_000 });

    // Connect the channel. The secret + token never round-trip back to the browser.
    await page.getByLabel("顯示名稱").fill(`E2E OA ${uniqueSuffix}`);
    await page.getByLabel("Channel ID").fill(`e2e-oa-${uniqueSuffix}`);
    await page.getByLabel("Channel secret").fill("e2e-super-secret-value");
    await page.getByLabel("長期 access token").fill("e2e-long-lived-access-token");
    await page.getByRole("button", { name: "連接 LINE" }).click();

    // The page flips to 已連接 and shows the channel id (not the secret).
    await expect(page.getByText("已連接", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`e2e-oa-${uniqueSuffix}`)).toBeVisible();
    // The secret must never appear anywhere on the page.
    await expect(page.getByText("e2e-super-secret-value")).toHaveCount(0);
    await expect(page.getByText("e2e-long-lived-access-token")).toHaveCount(0);

    // Outbox view: a brand-new org has no notifications yet (honest empty state).
    await page.goto("/app/notifications");
    await expect(page.getByText("目前沒有任何 LINE 通知紀錄。")).toBeVisible({ timeout: 20_000 });

    // Kill switch: disabling the channel returns the honest 未連接 state.
    await page.goto("/app/settings/line-channel");
    await expect(page.getByText("已連接")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /停用 LINE 連接/ }).click();
    await expect(page.getByText("LINE 未連接")).toBeVisible({ timeout: 20_000 });
  } finally {
    await closeContext(undefined);
  }
});
