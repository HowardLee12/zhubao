import { z } from "zod";

// Invite input for the pilot "team" screen. Owner is intentionally excluded — the
// org's single owner is set at organization creation and protected by a DB guard
// trigger; the invite RPC additionally rejects 'owner'. Phone, when supplied, must
// be E.164 (matching the memberships.phone check constraint); an empty string is
// normalized to null so an untouched optional field never fails validation.
export const createPilotMemberSchema = z
  .object({
    email: z.string().email().max(254),
    displayName: z.string().trim().min(1).max(80),
    role: z.enum(["admin", "dispatcher", "technician"]),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .nullable()
      .optional()
      .default(null),
  })
  .strict();

export type CreatePilotMember = z.infer<typeof createPilotMemberSchema>;

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
