import { z } from "zod";

const industryTemplateSchema = z.enum([
  "general_field_service",
  "cooling",
  "plumbing",
  "waterproofing",
  "renovation",
]);

const organizationRoleSchema = z.enum([
  "owner",
  "admin",
  "dispatcher",
  "technician",
  "accountant",
  "viewer",
]);

const membershipStatusSchema = z.enum([
  "invited",
  "active",
  "suspended",
  "removed",
]);

function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("zh-TW", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const createPilotOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
    industryTemplate: industryTemplateSchema,
    timezone: z.string().min(1).max(64).refine(isSupportedTimeZone, {
      message: "Unsupported IANA timezone.",
    }),
    currency: z.string().regex(/^[A-Z]{3}$/),
    ownerDisplayName: z.string().trim().min(1).max(80),
  })
  .strict();

const pilotOrganizationSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(120),
    slug: z.string().min(2).max(50),
    industryTemplate: industryTemplateSchema,
    timezone: z.string().min(1).max(64),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

const pilotMembershipSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    role: organizationRoleSchema,
    status: membershipStatusSchema,
    displayName: z.string().min(1).max(80),
  })
  .strict();

const pilotSessionMembershipSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    organizationName: z.string().min(1).max(120),
    organizationSlug: z.string().min(2).max(50),
    role: organizationRoleSchema,
    status: membershipStatusSchema,
  })
  .strict();

export const pilotOrganizationRpcResultSchema = z
  .object({
    organization: pilotOrganizationSchema,
    membership: pilotMembershipSchema,
  })
  .strict();

export const pilotSessionRpcResultSchema = z
  .object({
    memberships: z.array(pilotSessionMembershipSchema).max(100),
    activeOrganizationId: z.uuid().nullable(),
  })
  .strict();

export type CreatePilotOrganizationInput = z.infer<
  typeof createPilotOrganizationSchema
>;
export type PilotOrganizationRpcResult = z.infer<
  typeof pilotOrganizationRpcResultSchema
>;
export type PilotSessionRpcResult = z.infer<typeof pilotSessionRpcResultSchema>;
