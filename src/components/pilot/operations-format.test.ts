import { describe, expect, it } from "vitest";

import {
  assetEventLabel,
  assetTypeLabel,
  daysOverdue,
  followUpTab,
  formatKpiDuration,
  formatKpiRate,
  formatLocalDate,
  formatTwd,
  PAYMENT_STATUS_LABELS,
  timeOfDayGreeting,
} from "./operations-format";

describe("operations-format", () => {
  it("formats an integer minor amount as whole-NTD currency", () => {
    expect(formatTwd(2_500_000)).toBe("$2,500,000");
  });

  it("shows a dash for an absent amount (technician-redacted DTO)", () => {
    expect(formatTwd(undefined)).toBe("—");
  });

  it("renders a bare date in Asia/Taipei", () => {
    // 2026-10-01 is a plain org-local date; it must not shift a day.
    expect(formatLocalDate("2026-10-01")).toContain("2026");
  });

  it("returns a friendly label for a null date", () => {
    expect(formatLocalDate(null)).toBe("未設定");
  });

  it("computes whole days overdue from an org-local due date", () => {
    const now = new Date("2026-06-10T02:00:00Z"); // 2026-06-10 10:00 Asia/Taipei
    expect(daysOverdue("2026-06-01", now)).toBe(9);
    expect(daysOverdue("2026-06-15", now)).toBe(-5);
    expect(daysOverdue(null, now)).toBeNull();
  });

  it("labels statuses in Traditional Chinese", () => {
    expect(PAYMENT_STATUS_LABELS.overdue).toBe("已逾期");
    expect(assetTypeLabel("air_conditioner")).toBe("冷氣");
    expect(assetEventLabel("asset.serviced")).toBe("保養／清洗");
  });

  it("formats a KPI rate as a rounded percentage and degrades honestly at zero denominator", () => {
    expect(formatKpiRate(8, 10)).toBe("80%");
    expect(formatKpiRate(1, 3)).toBe("33%");
    expect(formatKpiRate(0, 0)).toBe("尚無足夠資料");
  });

  it("formats a duration in minutes, hours, or days", () => {
    expect(formatKpiDuration(45)).toBe("45 分");
    expect(formatKpiDuration(150)).toBe("2.5 時");
    expect(formatKpiDuration(2880)).toBe("2.0 天");
  });

  it("greets by time of day (local-hour based)", () => {
    const at = (hour: number) => new Date(2026, 5, 1, hour, 0, 0);
    expect(timeOfDayGreeting("老闆", at(3))).toContain("早安");
    expect(timeOfDayGreeting("老闆", at(14))).toContain("午安");
    expect(timeOfDayGreeting("老闆", at(21))).toContain("晚安");
  });

  it("derives follow-up tabs from plan status + due window", () => {
    const now = new Date("2026-06-01T00:00:00+08:00");
    expect(
      followUpTab({ status: "active", nextDueOn: "2026-06-10", leadDays: 14 }, now),
    ).toBe("due");
    expect(
      followUpTab({ status: "active", nextDueOn: "2026-08-01", leadDays: 14 }, now),
    ).toBe("later");
    expect(
      followUpTab({ status: "completed", nextDueOn: "2026-06-10", leadDays: 14 }, now),
    ).toBe("converted");
    expect(
      followUpTab({ status: "cancelled", nextDueOn: "2026-06-10", leadDays: 14 }, now),
    ).toBe("skipped");
  });
});
