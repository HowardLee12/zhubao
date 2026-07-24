import { describe, expect, it } from "vitest";

import {
  createPilotOrganizationSchema,
  pilotOrganizationRpcResultSchema,
  pilotSessionRpcResultSchema,
} from "./organization";

describe("createPilotOrganizationSchema", () => {
  const validInput = {
    name: "北城工程",
    slug: "north-city-service",
    industryTemplate: "general_field_service",
    timezone: "Asia/Taipei",
    currency: "TWD",
    ownerDisplayName: "王老闆",
  };

  it("trims human-readable fields and accepts a supported template", () => {
    expect(
      createPilotOrganizationSchema.parse({
        ...validInput,
        name: "  北城工程  ",
        ownerDisplayName: "  王老闆  ",
      }),
    ).toEqual(validInput);
  });

  it.each([
    ["uppercase slug", { slug: "North-City" }],
    ["unsafe slug", { slug: "north_city" }],
    ["unknown template", { industryTemplate: "restaurant" }],
    ["invalid timezone", { timezone: "Taipei/Unknown" }],
    ["invalid currency", { currency: "ntd" }],
    ["empty owner name", { ownerDisplayName: "   " }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      createPilotOrganizationSchema.parse({ ...validInput, ...override }),
    ).toThrow();
  });

  it("rejects unknown properties instead of silently accepting them", () => {
    expect(() =>
      createPilotOrganizationSchema.parse({
        ...validInput,
        serviceRoleKey: "must-never-pass-validation",
      }),
    ).toThrow();
  });
});

describe("pilot RPC result schemas", () => {
  it("accepts the organization and owner membership DTO returned by the RPC", () => {
    expect(
      pilotOrganizationRpcResultSchema.parse({
        organization: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "北城工程",
          slug: "north-city-service",
          industryTemplate: "general_field_service",
          timezone: "Asia/Taipei",
          currency: "TWD",
        },
        membership: {
          id: "22222222-2222-4222-8222-222222222222",
          organizationId: "11111111-1111-4111-8111-111111111111",
          role: "owner",
          status: "active",
          displayName: "王老闆",
        },
      }).membership.role,
    ).toBe("owner");
  });

  it("accepts an authenticated user with no organizations yet", () => {
    expect(
      pilotSessionRpcResultSchema.parse({
        memberships: [],
        activeOrganizationId: null,
      }),
    ).toEqual({ memberships: [], activeOrganizationId: null });
  });

  it("rejects unexpected secret-like RPC response fields", () => {
    expect(() =>
      pilotSessionRpcResultSchema.parse({
        memberships: [],
        activeOrganizationId: null,
        accessToken: "secret",
      }),
    ).toThrow();
  });
});
