import { describe, expect, it } from "vitest";

import { convertRequestSchema } from "./convert";

describe("convertRequestSchema", () => {
  it("accepts a single-visit conversion with no work order", () => {
    expect(convertRequestSchema.parse({ mode: "singleVisit" })).toEqual({
      mode: "singleVisit",
    });
  });

  it("accepts a project conversion with title and work order", () => {
    const body = {
      mode: "project" as const,
      projectTitle: "民生東路防水工程",
      workOrder: {
        title: "第一次到場勘查",
        scheduledStartAt: "2026-08-10T01:00:00.000Z",
        scheduledEndAt: "2026-08-10T04:00:00.000Z",
      },
    };
    expect(convertRequestSchema.parse(body)).toEqual(body);
  });

  it("requires a mode", () => {
    expect(() => convertRequestSchema.parse({})).toThrow();
  });

  it("rejects an unknown mode", () => {
    expect(() => convertRequestSchema.parse({ mode: "recurring" })).toThrow();
  });

  it("requires a work order title when a work order is supplied", () => {
    expect(() =>
      convertRequestSchema.parse({ mode: "singleVisit", workOrder: {} }),
    ).toThrow();
  });

  it("rejects assignment until conversion persists it", () => {
    expect(() =>
      convertRequestSchema.parse({
        mode: "singleVisit",
        workOrder: {
          title: "x",
          assigneeMembershipIds: ["30000000-0000-4000-8000-000000000003"],
        },
      }),
    ).toThrow();
  });

  it("rejects unknown top-level properties", () => {
    expect(() =>
      convertRequestSchema.parse({ mode: "singleVisit", extra: true }),
    ).toThrow();
  });
});
