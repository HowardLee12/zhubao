import { z } from "zod";

// Asset read DTO for the triage confirmation surface, mapping the real
// public.assets columns (database wins over the openapi CRUD DTO).
export const assetRowSchema = z
  .object({
    id: z.uuid(),
    customer_id: z.uuid(),
    location_id: z.uuid(),
    asset_no: z.string().min(1).max(40),
    asset_type: z.enum([
      "air_conditioner",
      "water_heater",
      "pump",
      "appliance",
      "other",
    ]),
    name: z.string().min(1).max(160),
    brand: z.string().max(120).nullable(),
    model: z.string().max(120).nullable(),
    serial_number: z.string().max(120).nullable(),
    installed_on: z.string().nullable(),
    status: z.enum(["active", "inactive", "retired"]),
    lock_version: z.number().int().min(1),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AssetRow = z.infer<typeof assetRowSchema>;

export interface AssetDto {
  id: string;
  customerId: string;
  locationId: string;
  assetNo: string;
  assetType: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  installedOn: string | null;
  status: string;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export function toAssetDto(row: AssetRow): AssetDto {
  return {
    id: row.id,
    customerId: row.customer_id,
    locationId: row.location_id,
    assetNo: row.asset_no,
    assetType: row.asset_type,
    name: row.name,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serial_number,
    installedOn: row.installed_on,
    status: row.status,
    lockVersion: row.lock_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const occurredAt = z.iso.datetime({ offset: true });

// M8 asset mutation request bodies. patch_asset / retire_asset gate on the
// If-Match lock version (header). Assets are OPTIONAL and never carry cost or
// amount — the asset DTOs are safe for the technician surface.
export const patchAssetSchema = z
  .object({
    name: z.string().trim().min(1).max(160).nullable().optional(),
    brand: z.string().max(120).nullable().optional(),
    model: z.string().max(120).nullable().optional(),
    serialNumber: z.string().max(120).nullable().optional(),
    installedOn: z.iso.date().nullable().optional(),
    warrantyExpiresOn: z.iso.date().nullable().optional(),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type PatchAssetInput = z.infer<typeof patchAssetSchema>;

export const retireAssetSchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000).nullable().optional(),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type RetireAssetInput = z.infer<typeof retireAssetSchema>;

// append_asset_service_event is append-only. It records a human-authored service
// note against the asset history projection; it never contains cost.
export const appendAssetServiceEventSchema = z
  .object({
    eventType: z.enum(["serviced", "inspected", "repaired", "installed", "note"]),
    summary: z.string().trim().min(1).max(2_000),
    workOrderId: z.uuid().nullable().optional(),
    servicedAt: occurredAt.nullable().optional(),
    occurredAt: occurredAt.optional(),
  })
  .strict();

export type AppendAssetServiceEventInput = z.infer<typeof appendAssetServiceEventSchema>;

export const assetHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export type AssetHistoryQuery = z.infer<typeof assetHistoryQuerySchema>;
