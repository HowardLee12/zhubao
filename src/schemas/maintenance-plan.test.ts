import { describe, expect, it } from "vitest";

import {
  approveNotificationsSchema,
  createMaintenancePlanSchema,
  prepareMaintenanceRemindersSchema,
} from "./maintenance-plan";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("maintenance-plan schemas", () => {
  it("accepts a valid plan", () => {
    const parsed = createMaintenancePlanSchema.parse({
      customerId: uuid,
      locationId: uuid,
      name: "半年保養",
      cadenceMonths: 6,
      nextDueOn: "2026-08-01",
    });
    expect(parsed.cadenceMonths).toBe(6);
  });

  it("bounds cadence to 1..60 months", () => {
    const base = { customerId: uuid, locationId: uuid, name: "x", nextDueOn: "2026-08-01" };
    expect(createMaintenancePlanSchema.safeParse({ ...base, cadenceMonths: 0 }).success).toBe(false);
    expect(createMaintenancePlanSchema.safeParse({ ...base, cadenceMonths: 61 }).success).toBe(
      false,
    );
  });

  it("prepare reminders caps the batch at 100", () => {
    const many = Array.from({ length: 101 }, () => uuid);
    expect(prepareMaintenanceRemindersSchema.safeParse({ planIds: many }).success).toBe(false);
    expect(prepareMaintenanceRemindersSchema.safeParse({ planIds: [uuid] }).success).toBe(true);
  });

  it("approve requires at least one notification id", () => {
    expect(approveNotificationsSchema.safeParse({ notificationIds: [] }).success).toBe(false);
    expect(approveNotificationsSchema.safeParse({ notificationIds: [uuid] }).success).toBe(true);
  });
});
