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
