import { z } from "zod";

// LINE channel identifiers issued by the LINE Developers console. `channelId` is
// the numeric bot user/basic channel id string; the secret and long-lived access
// token are the sensitive credentials that are AES-256-GCM encrypted server-side
// and NEVER returned to the browser. These schemas validate the connect/rotate
// request bodies; the response DTO only ever exposes credentialConfigured.

const channelId = z.string().trim().min(1).max(120);
const channelSecret = z.string().trim().min(1).max(200);
const accessToken = z.string().trim().min(1).max(4_096);

// POST .../line-channels — connect a channel. The server encrypts secret + token
// into private.line_channel_credentials and stores only metadata on the channel.
export const lineChannelConnectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    channelId,
    basicId: z.string().trim().min(1).max(120).nullable().optional(),
    liffId: z.string().trim().min(1).max(120).nullable().optional(),
    channelSecret,
    accessToken,
    tokenExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export type LineChannelConnectInput = z.infer<typeof lineChannelConnectSchema>;

// PATCH .../line-channels/:id — non-sensitive metadata only. Credentials are never
// mutated through this path (that is the rotate-token action).
export const lineChannelUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    basicId: z.string().trim().min(1).max(120).nullable().optional(),
    liffId: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少需要一個要更新的欄位。",
  });

export type LineChannelUpdateInput = z.infer<typeof lineChannelUpdateSchema>;

// POST .../line-channels/:id/actions/rotate-token — swap the long-lived token.
export const lineChannelRotateTokenSchema = z
  .object({
    accessToken,
    tokenExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export type LineChannelRotateTokenInput = z.infer<typeof lineChannelRotateTokenSchema>;

// POST .../line-channels/:id/actions/disable — kill switch. Reason is optional but
// bounded; it lands in the audit event payload.
export const lineChannelDisableSchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000).nullable().optional(),
  })
  .strict();

export type LineChannelDisableInput = z.infer<typeof lineChannelDisableSchema>;

// Client-facing channel view. Ciphertext, nonces and key material are structurally
// unrepresentable here — the only credential signal is the boolean. This is the DTO
// the connect/verify/list routes serialize.
export const lineChannelViewSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    channelId: z.string(),
    basicId: z.string().nullable(),
    liffId: z.string().nullable(),
    status: z.enum(["pending", "active", "disabled", "error"]),
    credentialConfigured: z.boolean(),
    webhookVerifiedAt: z.string().nullable(),
    lastWebhookAt: z.string().nullable(),
    lastErrorCode: z.string().nullable(),
    lockVersion: z.number().int().positive(),
  })
  .strict();

export type LineChannelView = z.infer<typeof lineChannelViewSchema>;
