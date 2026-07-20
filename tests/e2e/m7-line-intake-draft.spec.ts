import { expect, test } from "@playwright/test";

import { closeContext, onboardOwner } from "./m5-support";
import {
  ingestLineMessage,
  resolveOrganizationId,
  runIntakeExtractionWorker,
  seedDegradedManualDraft,
  seedLineChannel,
  serviceRoleClient,
} from "./m7-support";

/**
 * M7 LINE intake → AI draft → confirm journey (Fake AI + simulated LINE, no real
 * api.line.me / Fireworks).
 *
 * A fresh owner onboards. A LINE customer sends a text then an image; the messages
 * aggregate into one conversation. The real intake-extraction worker (Fake AI OK)
 * turns that conversation into a "待確認 · LINE" draft. The owner opens the inbox,
 * sees the badge, drills into the draft-review screen (immutable original messages +
 * AI fields with per-field confidence/source), and confirms — the ONLY path to a
 * service_request (no auto-convert). The created request appears in the M3 triage
 * detail. The product rule holds: AI only drafts; a human confirms.
 */
test("owner confirms a LINE AI draft into a service request", async ({
  page,
  request,
}, testInfo) => {
  const uniqueSuffix = `${Date.now()}-${testInfo.workerIndex}`;
  const organizationSlug = `pilot-m7-${uniqueSuffix}`;

  await onboardOwner(page, request, {
    ownerEmail: `pilot-m7-${uniqueSuffix}@example.test`,
    organizationName: `E2E LINE 進件行 ${uniqueSuffix}`,
    organizationSlug,
  });

  const admin = serviceRoleClient();
  const organizationId = await resolveOrganizationId(admin, organizationSlug);
  const { channelId, identityId, lineUserId } = await seedLineChannel(admin, organizationId);

  // A LINE customer sends two messages; they aggregate into ONE conversation.
  const first = await ingestLineMessage(admin, {
    organizationId,
    channelId,
    lineUserId,
    identityId,
    text: "冷氣不冷想約人來看",
  });
  const second = await ingestLineMessage(admin, {
    organizationId,
    channelId,
    lineUserId,
    identityId,
    text: "地址台北市大安區，附上一張照片",
    messageType: "image",
  });
  expect(second.conversationId).toBe(first.conversationId);

  // The real worker (Fake AI OK) turns the conversation into an AI draft.
  await runIntakeExtractionWorker(request);

  // Inbox: the pending tab shows the LINE draft with its 待確認 · LINE badge.
  await page.goto("/app/inbox");
  await expect(page.getByRole("heading", { name: "接案匣" })).toBeVisible({ timeout: 20_000 });
  const draftCard = page.locator("article", { hasText: "待確認 · LINE" }).first();
  await expect(draftCard).toBeVisible({ timeout: 20_000 });
  await draftCard.getByRole("link", { name: "確認 LINE 進件" }).click();

  // Draft-review: immutable original messages on the left, AI fields on the right.
  await expect(page).toHaveURL(/\/app\/inbox\/drafts\/[0-9a-f-]+$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "原始訊息" })).toBeVisible();
  await expect(page.getByText("此區塊為 LINE 原始訊息，不可修改", { exact: false })).toBeVisible();
  await expect(page.getByText("冷氣不冷想約人來看").first()).toBeVisible();
  // The editable structured summary is pre-filled from the AI extraction.
  const subject = page.getByLabel("主旨");
  await expect(subject).toBeEditable();
  await expect(subject).not.toHaveValue("");

  // Confirm — creates the service_request (source=line). Human-in-the-loop gate.
  await page.getByRole("button", { name: "建立服務案件" }).click();
  await expect(page.getByText("已建立服務案件，可前往整理進件。")).toBeVisible({
    timeout: 20_000,
  });
  const requestNo = page.getByText(/^SR-\d{6}-\d{6}$/).first();
  await expect(requestNo).toBeVisible();

  // The created request is reachable in the M3 triage detail.
  await page.getByRole("link", { name: "前往整理進件 →" }).click();
  await expect(page).toHaveURL(/\/app\/inbox\/[0-9a-f-]+$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "整理後摘要" })).toBeVisible({
    timeout: 20_000,
  });

  await closeContext(undefined);
});

/**
 * M7 degradation: when the AI extraction fails (unavailable / timeout / bad output),
 * intake is NEVER blocked — the conversation still lands as a MANUAL draft with the
 * original messages preserved, and it is still confirmable by a human. This seeds the
 * manual end state the gateway persists on AI failure (the worker route always runs
 * Fake OK locally), then confirms it through the same review UI.
 */
test("a degraded LINE draft is still shown as manual and stays confirmable", async ({
  page,
  request,
}, testInfo) => {
  const uniqueSuffix = `${Date.now()}-${testInfo.workerIndex}-deg`;
  const organizationSlug = `pilot-m7d-${uniqueSuffix}`;

  await onboardOwner(page, request, {
    ownerEmail: `pilot-m7d-${uniqueSuffix}@example.test`,
    organizationName: `E2E LINE 降級行 ${uniqueSuffix}`,
    organizationSlug,
  });

  const admin = serviceRoleClient();
  const organizationId = await resolveOrganizationId(admin, organizationSlug);
  const { channelId, identityId, lineUserId } = await seedLineChannel(admin, organizationId);

  const { conversationId } = await ingestLineMessage(admin, {
    organizationId,
    channelId,
    lineUserId,
    identityId,
    text: "馬桶漏水，麻煩盡快",
  });

  // The AI extractor failed: the gateway degraded this to a MANUAL draft. Intake is
  // preserved; nothing was lost.
  await seedDegradedManualDraft(admin, { organizationId, conversationId });

  await page.goto("/app/inbox");
  await expect(page.getByRole("heading", { name: "接案匣" })).toBeVisible({ timeout: 20_000 });
  const draftCard = page.locator("article", { hasText: "待確認 · LINE" }).first();
  await expect(draftCard).toBeVisible({ timeout: 20_000 });
  // The card is honest about the degradation.
  await expect(draftCard.getByText("AI 整理失敗")).toBeVisible();
  await draftCard.getByRole("link", { name: "確認 LINE 進件" }).click();

  // Review screen: the degraded notice + the preserved original message.
  await expect(page.getByText("AI 整理失敗，可手動處理。", { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("馬桶漏水，麻煩盡快").first()).toBeVisible();

  // A human fills the summary in and confirms — the manual draft still converts.
  const subject = page.getByLabel("主旨");
  await subject.fill("馬桶漏水維修");
  await page.getByLabel("問題與需求說明").fill("客戶反映馬桶漏水，需盡快到府處理。");
  await page.getByRole("button", { name: "建立服務案件" }).click();
  await expect(page.getByText("已建立服務案件，可前往整理進件。")).toBeVisible({
    timeout: 20_000,
  });

  await closeContext(undefined);
});
