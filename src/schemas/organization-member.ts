import { z } from "zod";

export const organizationMemberRowSchema = z
  .object({
    id: z.uuid(),
    display_name: z.string().min(1).max(80),
    role: z.enum(["owner", "admin", "dispatcher", "technician"]),
    status: z.enum(["invited", "active", "suspended", "removed"]),
  })
  .strict();

export type OrganizationMemberRow = z.infer<typeof organizationMemberRowSchema>;

export interface OrganizationMemberDto {
  id: string;
  displayName: string;
  role: "owner" | "admin" | "dispatcher" | "technician";
  status: "invited" | "active" | "suspended" | "removed";
}

export function toOrganizationMember(
  row: OrganizationMemberRow,
): OrganizationMemberDto {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
  };
}
