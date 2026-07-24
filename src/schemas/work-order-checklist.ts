import { z } from "zod";

const responseType = z.enum([
  "boolean",
  "text",
  "number",
  "single_choice",
  "multi_choice",
  "photo",
]);

const checklistItemSchema = z
  .object({
    label: z.string().trim().min(1).max(300),
    responseType,
    isRequired: z.boolean().optional(),
    evidenceRequired: z.boolean().optional(),
    options: z.array(z.string().min(1).max(300)).max(50).optional(),
  })
  .strict();

// POST .../work-orders/:id/checklists — inline checklist creation (manager only).
export const checklistCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    items: z.array(checklistItemSchema).min(1).max(200),
  })
  .strict();

export type ChecklistCreateInput = z.infer<typeof checklistCreateSchema>;

// PATCH .../work-order-checklists/:id/items/:itemId — respond to one item. The
// If-Match header carries the parent work-order lock version. response accepts
// any JSON value; the RPC enforces type-per-responseType.
export const checklistItemRespondSchema = z
  .object({
    response: z.unknown().refine((value) => value !== undefined && value !== null, {
      message: "作答內容不可為空。",
    }),
  })
  .strict();

export type ChecklistItemRespondInput = z.infer<typeof checklistItemRespondSchema>;
