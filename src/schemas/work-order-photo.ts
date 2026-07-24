import { z } from "zod";

export const WORK_ORDER_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const WORK_ORDER_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const photoCategory = z.enum([
  "intake",
  "before",
  "after",
  "issue",
  "receipt",
  "signature",
  "other",
]);

// POST .../work-orders/:id/photo-uploads — reserve a pending photo row and mint a
// signed PUT URL. The client declares the MIME/size/sha256 it is about to upload;
// verification against the real bytes happens at complete time.
export const photoUploadCreateSchema = z
  .object({
    category: photoCategory,
    filename: z.string().trim().min(1).max(200),
    contentType: z.enum(WORK_ORDER_PHOTO_TYPES),
    byteSize: z.number().int().min(1).max(WORK_ORDER_PHOTO_MAX_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    checklistItemId: z.uuid().nullable().optional(),
    caption: z.string().max(1_000).optional(),
    capturedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export type PhotoUploadCreateInput = z.infer<typeof photoUploadCreateSchema>;

// PATCH .../photos/:photoId — caption/category edit (If-Match on the photo).
export const photoUpdateSchema = z
  .object({
    caption: z.string().max(1_000).nullable().optional(),
    category: photoCategory.optional(),
  })
  .strict()
  .refine((value) => value.caption !== undefined || value.category !== undefined, {
    message: "至少需要一個要更新的欄位。",
  });

export type PhotoUpdateInput = z.infer<typeof photoUpdateSchema>;
