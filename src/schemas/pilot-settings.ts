import { z } from "zod";

const industryTemplateSchema = z.enum([
  "general_field_service",
  "cooling",
  "plumbing",
  "waterproofing",
  "renovation",
]);

// Bounds mirror update_pilot_organization_settings (migration 0005): the RPC
// rejects headline > 160 or privacy notice > 2000, so the TS contract must not
// accept what the database will refuse.
export const pilotSettingsRpcResultSchema = z
  .object({
    organizationId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    industryTemplate: industryTemplateSchema,
    intakeHeadline: z.string().trim().min(1).max(160),
    privacyNotice: z.string().trim().min(1).max(2_000),
    lockVersion: z.number().int().min(1),
  })
  .strict();

export const updatePilotSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    intakeHeadline: z.string().trim().min(1).max(160),
    privacyNotice: z.string().trim().min(1).max(2_000),
    lockVersion: z.number().int().min(1),
  })
  .strict();

export type PilotSettings = z.infer<typeof pilotSettingsRpcResultSchema>;
export type UpdatePilotSettings = z.infer<typeof updatePilotSettingsSchema>;
