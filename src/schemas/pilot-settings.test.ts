import { describe, expect, it } from "vitest";

import {
  pilotSettingsRpcResultSchema,
  updatePilotSettingsSchema,
} from "./pilot-settings";

const settings = {
  organizationId: "2f66bf0a-b8d9-4722-9e2a-23f218f25d86",
  name: "北城工程",
  industryTemplate: "general_field_service",
  intakeHeadline: "描述需求，我們確認後聯絡您",
  privacyNotice: "資料僅供本次服務聯繫使用。",
  lockVersion: 1,
};

describe("pilot settings schemas", () => {
  it("accepts the allowlisted staff settings projection", () => {
    expect(pilotSettingsRpcResultSchema.parse(settings)).toEqual(settings);
  });

  it("accepts a bounded optimistic-locking update", () => {
    expect(
      updatePilotSettingsSchema.parse({
        name: settings.name,
        intakeHeadline: settings.intakeHeadline,
        privacyNotice: settings.privacyNotice,
        lockVersion: 2,
      }),
    ).toMatchObject({ lockVersion: 2 });
  });

  it("enforces the database bounds for headline and privacy notice", () => {
    const update = {
      name: settings.name,
      intakeHeadline: "標".repeat(160),
      privacyNotice: "私".repeat(2_000),
      lockVersion: 2,
    };
    expect(updatePilotSettingsSchema.parse(update)).toMatchObject({
      lockVersion: 2,
    });

    expect(() =>
      updatePilotSettingsSchema.parse({
        ...update,
        intakeHeadline: "標".repeat(161),
      }),
    ).toThrow();
    expect(() =>
      updatePilotSettingsSchema.parse({
        ...update,
        privacyNotice: "私".repeat(2_001),
      }),
    ).toThrow();
  });

  it("rejects arbitrary settings keys", () => {
    expect(() =>
      updatePilotSettingsSchema.parse({
        name: settings.name,
        intakeHeadline: settings.intakeHeadline,
        privacyNotice: settings.privacyNotice,
        lockVersion: 1,
        serviceRoleKey: "do-not-store",
      }),
    ).toThrow();
  });
});
