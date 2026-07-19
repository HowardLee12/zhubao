import { z } from "zod";

export const PUBLIC_INTAKE_PHOTO_LIMIT = 3;
export const PUBLIC_INTAKE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PUBLIC_INTAKE_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const E164_PHONE = /^\+[1-9][0-9]{7,14}$/;

function normalizedPhoneOrNull(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, "");

  if (compact.startsWith("+")) {
    return E164_PHONE.test(compact) ? compact : null;
  }

  if (/^0[1-9][0-9]{7,9}$/.test(compact)) {
    const international = `+886${compact.slice(1)}`;
    return E164_PHONE.test(international) ? international : null;
  }

  return null;
}

export function normalizeTaiwanPhone(input: string): string {
  const normalized = normalizedPhoneOrNull(input);
  if (!normalized) {
    throw new Error("INVALID_PHONE");
  }

  return normalized;
}

const publicPhoneSchema = z
  .string()
  .max(40)
  .refine((value) => normalizedPhoneOrNull(value) !== null, "請輸入有效的台灣電話號碼")
  .transform((value) => normalizeTaiwanPhone(value));

const preferredWindowSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    preferenceRank: z.number().int().min(1).max(5),
  })
  .strict()
  .refine(({ startsAt, endsAt }) => Date.parse(endsAt) > Date.parse(startsAt), {
    path: ["endsAt"],
    message: "結束時間必須晚於開始時間",
  });

const publicAddressSchema = z
  .object({
    postalCode: z.string().trim().min(3).max(10).optional(),
    county: z.string().trim().min(1).max(40).optional(),
    district: z.string().trim().min(1).max(40).optional(),
    // submit_pilot_service_request rejects addressLine > 300 (migration 0005).
    addressLine: z.string().trim().min(1).max(300),
    accessNotes: z.string().trim().max(500).optional(),
  })
  .strict();

export const publicServiceRequestRequestSchema = z
  .object({
    submissionId: z.uuid(),
    contactName: z.string().trim().min(1).max(120),
    contactPhone: publicPhoneSchema,
    serviceCatalogItemId: z.uuid(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(10_000),
    address: publicAddressSchema,
    preferredWindows: z.array(preferredWindowSchema).max(5),
    photoIds: z.array(z.uuid()).max(PUBLIC_INTAKE_PHOTO_LIMIT),
    privacyAccepted: z.literal(true),
    companyWebsite: z.literal(""),
  })
  .strict()
  .superRefine((value, context) => {
    const ranks = value.preferredWindows.map(({ preferenceRank }) => preferenceRank);
    if (new Set(ranks).size !== ranks.length) {
      context.addIssue({
        code: "custom",
        path: ["preferredWindows"],
        message: "偏好順位不可重複",
      });
    }

    if (new Set(value.photoIds).size !== value.photoIds.length) {
      context.addIssue({
        code: "custom",
        path: ["photoIds"],
        message: "照片不可重複",
      });
    }
  });

export const publicPhotoUploadRequestSchema = z
  .object({
    submissionId: z.uuid(),
    filename: z.string().trim().min(1).max(200),
    contentType: z.enum(PUBLIC_INTAKE_PHOTO_TYPES),
    byteSize: z.number().int().min(1).max(PUBLIC_INTAKE_PHOTO_MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const publicPhotoCompleteRequestSchema = z
  .object({
    submissionId: z.uuid(),
  })
  .strict();

export type PublicServiceRequestRequest = z.infer<typeof publicServiceRequestRequestSchema>;
export type PublicPhotoUploadRequest = z.infer<typeof publicPhotoUploadRequestSchema>;
export type PublicPhotoCompleteRequest = z.infer<typeof publicPhotoCompleteRequestSchema>;
