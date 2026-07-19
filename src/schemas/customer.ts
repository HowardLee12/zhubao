import { z } from "zod";

export const createPilotCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .nullable()
      .optional()
      .default(null),
  })
  .strict();

export type CreatePilotCustomer = z.infer<typeof createPilotCustomerSchema>;

// Customer read DTO for the triage confirmation surface. These schemas map the
// real public.customers columns (database wins over the fuller openapi CRUD DTO
// which is not yet implemented). Cost/internal columns (tax_id, tags, deleted_at,
// organization_id) are deliberately never selected, so they can never leak.

export const customerRowSchema = z
  .object({
    id: z.uuid(),
    customer_no: z.string().min(1).max(40),
    kind: z.enum(["individual", "company"]),
    name: z.string().min(1).max(120),
    phone: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .nullable(),
    email: z.string().max(254).nullable(),
    company_name: z.string().max(200).nullable(),
    source: z.enum(["line", "phone", "web", "referral", "manual", "import"]),
    notes: z.string().max(5000),
    last_contact_at: z.iso.datetime({ offset: true }).nullable(),
    lock_version: z.number().int().min(1),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CustomerRow = z.infer<typeof customerRowSchema>;

export interface CustomerDto {
  id: string;
  customerNo: string;
  kind: "individual" | "company";
  name: string;
  phone: string | null;
  email: string | null;
  companyName: string | null;
  source: string;
  notes: string;
  lastContactAt: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export function toCustomerDto(row: CustomerRow): CustomerDto {
  return {
    id: row.id,
    customerNo: row.customer_no,
    kind: row.kind,
    name: row.name,
    phone: row.phone,
    email: row.email,
    companyName: row.company_name,
    source: row.source,
    notes: row.notes,
    lastContactAt: row.last_contact_at,
    lockVersion: row.lock_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// find_similar_customers RPC row -> hint DTO. Hint-only: never auto-merges.
export const similarCustomerRpcSchema = z
  .object({
    customer_id: z.uuid(),
    customer_no: z.string().min(1).max(40),
    name: z.string().min(1).max(200),
    phone: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .nullable(),
    match_reason: z.enum(["phone", "name"]),
  })
  .strict();

export type SimilarCustomerRpcRow = z.infer<typeof similarCustomerRpcSchema>;

export interface SimilarCustomer {
  customerId: string;
  customerNo: string;
  name: string;
  phone: string | null;
  matchReason: "phone" | "name";
}

export function toSimilarCustomer(row: SimilarCustomerRpcRow): SimilarCustomer {
  return {
    customerId: row.customer_id,
    customerNo: row.customer_no,
    name: row.name,
    phone: row.phone,
    matchReason: row.match_reason,
  };
}
