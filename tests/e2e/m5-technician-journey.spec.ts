import { deflateSync } from "node:zlib";

import { expect, test, type Page } from "@playwright/test";

import { createConvertedWorkOrder } from "./m5-support";

/**
 * M5 technician field journey.
 *
 * A fresh owner onboards, converts an intake into a work order, schedules +
 * assigns themselves, then works the field flow as the assigned crew:
 * dispatched → en_route → on_site → checklist + before/after photos → complete.
 *
 * It also proves the blocked-completion guard (missing after photo → blocked and
 * the missing item is NAMED, J06-AC03) and owner exception completion (which is
 * explicitly not a customer sign-off).
 */

function computeCrc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A minimal but genuinely valid 1x1 PNG: the server sniffs the magic bytes and
// reads the IHDR dimensions before flipping the photo to ready.
function tinyPng(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(computeCrc32(typeAndData), 0);
    return Buffer.concat([length, typeAndData, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function nextWeekLocal(offsetHours: number): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(9 + offsetHours, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

// Seed a work-order checklist through the real dispatcher route. The completion
// gate (require_completion_snapshot) requires at least one checklist snapshot to
// exist before a work order can be completed; the fresh cooling org's convert
// path does not attach one, so the test creates it via the same API the product
// uses. This is legitimate setup, not a DB shortcut. It also gives the field
// screen a required item to answer, exercising the checklist UI.
async function seedChecklist(page: Page, orgId: string, workOrderId: string): Promise<void> {
  // Run the fetch inside the page so it is same-origin and carries the app's
  // double-submit CSRF cookie exactly like the product does.
  const result = await page.evaluate(
    async ({ orgId, workOrderId }) => {
      const readCookie = (name: string): string => {
        for (const part of document.cookie.split(";")) {
          const eq = part.indexOf("=");
          if (eq !== -1 && part.slice(0, eq).trim() === name) {
            return decodeURIComponent(part.slice(eq + 1).trim());
          }
        }
        return "";
      };
      const response = await fetch(
        `/api/v2/organizations/${orgId}/work-orders/${workOrderId}/checklists`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": readCookie("renoly-csrf"),
          },
          body: JSON.stringify({
            name: "完工檢查",
            items: [{ label: "確認運轉正常", responseType: "boolean", isRequired: true }],
          }),
        },
      );
      return { ok: response.ok, status: response.status, text: await response.text() };
    },
    { orgId, workOrderId },
  );
  expect(result.ok, result.text).toBeTruthy();
}

async function resolveOrgId(page: Page): Promise<string> {
  const body = await page.evaluate(async () => {
    const response = await fetch("/api/v2/session", { headers: { Accept: "application/json" } });
    return (await response.json()) as {
      data: { memberships: Array<{ organizationId: string; status: string }> };
    };
  });
  const membership = body.data.memberships.find((entry) => entry.status === "active");
  return membership?.organizationId ?? "";
}

async function scheduleSelf(page: Page, workOrderId: string, requestTitle: RegExp): Promise<void> {
  await page.goto(`/app/work-orders/${workOrderId}`);
  await expect(page.getByRole("heading", { name: requestTitle })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "排程並指派" }).click();
  await page.getByLabel("開始時間").fill(nextWeekLocal(0));
  await page.getByLabel("結束時間").fill(nextWeekLocal(2));
  await page.getByRole("button", { name: "載入可指派師傅" }).click();
  await page.getByRole("checkbox", { name: /E2E 老闆/ }).check();
  await page.getByRole("button", { name: "確認排程" }).click();
  await expect(page.getByText(/已排程並派工/)).toBeVisible({ timeout: 20_000 });

  // Dispatch to the crew so the assigned technician can start the field flow.
  await page.getByRole("button", { name: "派工給師傅" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已派工。" })).toBeVisible({
    timeout: 20_000,
  });
}

async function uploadPhoto(page: Page, label: string): Promise<void> {
  // Each capture tile is a <label> wrapping a hidden file input; scope by its text.
  const tile = page
    .locator("label")
    .filter({ hasText: label })
    .filter({ has: page.locator('input[type="file"]') });
  await tile.locator('input[type="file"]').setInputFiles({
    name: `${label}.png`,
    mimeType: "image/png",
    buffer: tinyPng(),
  });
}

test("technician works a field job through to completion, blocked then unblocked", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const uniqueSuffix = `${Date.now()}-${testInfo.workerIndex}`;
  const requestTitle = new RegExp(`E2E 技師旅程 ${uniqueSuffix}`);
  let closeCustomer: (() => Promise<void>) | undefined;

  try {
    const { workOrderId, closeCustomer: close } = await createConvertedWorkOrder(
      page,
      request,
      () => browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" }),
      {
        ownerEmail: `pilot-m5t-${uniqueSuffix}@example.test`,
        organizationName: `E2E 技師冷氣行 ${uniqueSuffix}`,
        organizationSlug: `pilot-m5t-${uniqueSuffix}`,
        requestTitle: `E2E 技師旅程 ${uniqueSuffix}`,
      },
    );
    closeCustomer = close;

    const orgId = await resolveOrgId(page);
    await seedChecklist(page, orgId, workOrderId);
    await scheduleSelf(page, workOrderId, requestTitle);

    // Enter the field screen for this work order.
    await page.goto(`/app/my-work-orders/${workOrderId}`);
    await expect(page.getByRole("heading", { name: requestTitle })).toBeVisible({ timeout: 20_000 });

    // Single primary action advances: dispatched -> en_route -> on_site.
    await page.getByRole("button", { name: "出發前往" }).click();
    await expect(page.getByRole("button", { name: "抵達現場" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "抵達現場" }).click();
    await expect(page.getByText("施工中", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // Answer the required checklist item (marked 必填 in the field UI).
    await expect(page.getByText("確認運轉正常")).toBeVisible();
    await page.getByRole("button", { name: "是", exact: true }).click();
    await expect(page.getByText("已填").first()).toBeVisible({ timeout: 20_000 });

    // Fill the completion summary but leave photos missing -> completion is blocked
    // and the missing after photo is NAMED (before also missing at this point).
    await page.getByPlaceholder(/已完成兩台冷氣清洗/).fill("已完成清洗，運轉正常。");
    await page.getByRole("button", { name: "完工回報" }).click();
    await expect(
      page.getByRole("list", { name: "待補齊項目" }).getByText(/缺少施工後照片/),
    ).toBeVisible();

    // Upload a before and an after photo, then completion succeeds. Each capture
    // tile shows a per-category count that flips to "已 1 張" once ready.
    const beforeTile = page.locator("label").filter({ hasText: "施工前" });
    const afterTile = page.locator("label").filter({ hasText: "施工後" });
    await uploadPhoto(page, "施工前");
    await expect(beforeTile.getByText("已 1 張")).toBeVisible({ timeout: 20_000 });
    await uploadPhoto(page, "施工後");
    await expect(afterTile.getByText("已 1 張")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "完工回報" }).click();
    await expect(page.getByText(/此工單已完工/)).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/完工通知尚未自動發送/)).toBeVisible();
  } finally {
    if (closeCustomer) await closeCustomer();
  }
});

test("owner force-completes a work order as an explicit exception, not a sign-off", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const uniqueSuffix = `${Date.now()}-fc-${testInfo.workerIndex}`;
  const requestTitle = new RegExp(`E2E 例外完工 ${uniqueSuffix}`);
  let closeCustomer: (() => Promise<void>) | undefined;

  try {
    const { workOrderId, closeCustomer: close } = await createConvertedWorkOrder(
      page,
      request,
      () => browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" }),
      {
        ownerEmail: `pilot-m5fc-${uniqueSuffix}@example.test`,
        organizationName: `E2E 例外冷氣行 ${uniqueSuffix}`,
        organizationSlug: `pilot-m5fc-${uniqueSuffix}`,
        requestTitle: `E2E 例外完工 ${uniqueSuffix}`,
      },
    );
    closeCustomer = close;

    // Force-complete bypasses the checklist/photo gate but still needs a checklist
    // snapshot to exist (require_completion_snapshot); seed one via the real route.
    const orgId = await resolveOrgId(page);
    await seedChecklist(page, orgId, workOrderId);
    await scheduleSelf(page, workOrderId, requestTitle);

    // Drive to on_site via the field screen so force-complete is offered.
    await page.goto(`/app/my-work-orders/${workOrderId}`);
    await expect(page.getByRole("button", { name: "出發前往" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "出發前往" }).click();
    await page.getByRole("button", { name: "抵達現場" }).click();
    await expect(page.getByText("施工中", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // Back on the dispatcher workspace, the owner force-completes.
    await page.goto(`/app/work-orders/${workOrderId}`);
    await page.getByRole("button", { name: "例外完工（非客戶簽認）" }).click();
    await expect(page.getByText(/例外完工，非客戶簽認/)).toBeVisible();

    await page.getByPlaceholder(/客戶臨時外出/).fill("客戶臨時外出，由管委代為確認現場");
    await page.getByPlaceholder(/簡述實際完成/).fill("已完成清洗，例外流程結案。");
    await page.getByRole("button", { name: "確認例外完工" }).click();

    await expect(page.getByText(/已例外完工（非客戶簽認）/)).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText("已完工", { exact: true }).first()).toBeVisible();
  } finally {
    if (closeCustomer) await closeCustomer();
  }
});
