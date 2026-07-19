import { z } from "zod";

// Location read DTO for the triage confirmation surface, mapping the real
// public.locations columns (database wins over the openapi CRUD DTO).
export const locationRowSchema = z
  .object({
    id: z.uuid(),
    customer_id: z.uuid(),
    label: z.string().min(1).max(80),
    contact_name: z.string().max(120).nullable(),
    contact_phone: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .nullable(),
    postal_code: z.string().max(12).nullable(),
    county: z.string().max(80).nullable(),
    district: z.string().max(80).nullable(),
    address_line: z.string().min(1).max(300),
    access_notes: z.string().max(2000),
    is_default: z.boolean(),
    lock_version: z.number().int().min(1),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type LocationRow = z.infer<typeof locationRowSchema>;

export interface LocationDto {
  id: string;
  customerId: string;
  label: string;
  contactName: string | null;
  contactPhone: string | null;
  postalCode: string | null;
  county: string | null;
  district: string | null;
  addressLine: string;
  accessNotes: string;
  isDefault: boolean;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export function toLocationDto(row: LocationRow): LocationDto {
  return {
    id: row.id,
    customerId: row.customer_id,
    label: row.label,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    postalCode: row.postal_code,
    county: row.county,
    district: row.district,
    addressLine: row.address_line,
    accessNotes: row.access_notes,
    isDefault: row.is_default,
    lockVersion: row.lock_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
