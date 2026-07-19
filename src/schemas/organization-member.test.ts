import { describe, expect, it } from "vitest";

import {
  organizationMemberRowSchema,
  toOrganizationMember,
} from "./organization-member";

describe("organization member assignment DTO", () => {
  it("maps the allowlisted RPC row to camelCase", () => {
    const row = organizationMemberRowSchema.parse({
      id: "30000000-0000-4000-8000-000000000003",
      display_name: "Alpha 技師 A",
      role: "technician",
      status: "active",
    });
    expect(toOrganizationMember(row)).toEqual({
      id: row.id,
      displayName: "Alpha 技師 A",
      role: "technician",
      status: "active",
    });
  });

  it("rejects internal or unexpected columns", () => {
    expect(
      organizationMemberRowSchema.safeParse({
        id: "30000000-0000-4000-8000-000000000003",
        display_name: "Alpha 技師 A",
        role: "technician",
        status: "active",
        organization_id: "20000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });
});
