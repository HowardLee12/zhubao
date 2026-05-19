// ECPay (綠界) 定期定額 helper.
//
// Credentials come from env vars (never commit):
//   ECPAY_MERCHANT_ID, ECPAY_HASH_KEY, ECPAY_HASH_IV, ECPAY_ENV
//   NEXT_PUBLIC_APP_URL  (used to build callback URLs)
//
// Docs: https://developers.ecpay.com.tw/?p=2856 (AIO 定期定額)

import { createHash } from "node:crypto";

export const ECPAY_ENV = (process.env.ECPAY_ENV ?? "stage") as
  | "stage"
  | "production";

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID ?? "";
const HASH_KEY = process.env.ECPAY_HASH_KEY ?? "";
const HASH_IV = process.env.ECPAY_HASH_IV ?? "";

export const ECPAY_AIO_URL =
  ECPAY_ENV === "production"
    ? "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5"
    : "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";

export function ecpayConfigured(): boolean {
  return Boolean(MERCHANT_ID && HASH_KEY && HASH_IV);
}

// .NET HttpUtility.UrlEncode-compatible encoding, then ECPay's documented
// character substitutions. This MUST match ECPay exactly or CheckMacValue
// verification fails.
function dotNetUrlEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/%20/g, "+")
    .replace(/%21/g, "!")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%2a/gi, "*")
    .replace(/%2d/gi, "-")
    .replace(/%2e/gi, ".")
    .replace(/%5f/gi, "_");
}

export function makeCheckMacValue(params: Record<string, string>): string {
  // 1. sort keys A→Z (case-insensitive)
  const sortedKeys = Object.keys(params).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
  // 2. join, wrapped with HashKey / HashIV
  const raw =
    `HashKey=${HASH_KEY}&` +
    sortedKeys.map((k) => `${k}=${params[k]}`).join("&") +
    `&HashIV=${HASH_IV}`;
  // 3. .NET url-encode, 4. lowercase, 5. SHA256, 6. uppercase
  const encoded = dotNetUrlEncode(raw).toLowerCase();
  return createHash("sha256").update(encoded).digest("hex").toUpperCase();
}

// Build the full param set for a 定期定額 (recurring monthly) order.
export function buildSubscriptionOrder(opts: {
  userId: string;
  amount: number;
  itemName: string;
  tradeNo: string; // unique, ≤20 alphanumeric
}): Record<string, string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const tradeDate = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const params: Record<string, string> = {
    MerchantID: MERCHANT_ID,
    MerchantTradeNo: opts.tradeNo,
    MerchantTradeDate: tradeDate,
    PaymentType: "aio",
    TotalAmount: String(opts.amount),
    TradeDesc: "Renoly Pro 訂閱",
    ItemName: opts.itemName,
    ReturnURL: `${appUrl}/api/ecpay/callback`,
    OrderResultURL: `${appUrl}/api/ecpay/result`,
    ClientBackURL: `${appUrl}/account`,
    ChoosePayment: "Credit", // 定期定額 only supports credit card
    EncryptType: "1",
    // ===== 定期定額 =====
    PeriodAmount: String(opts.amount),
    PeriodType: "M", // monthly
    Frequency: "1", // every 1 month
    ExecTimes: "99", // ~8 years; ECPay max for monthly is 99
    PeriodReturnURL: `${appUrl}/api/ecpay/callback`,
    // carry the user id back so the callback knows who paid
    CustomField1: opts.userId,
  };

  params.CheckMacValue = makeCheckMacValue(params);
  return params;
}

// Verify a callback payload from ECPay.
export function verifyCallback(
  payload: Record<string, string>
): { valid: boolean; success: boolean; userId: string; tradeNo: string } {
  const received = payload.CheckMacValue ?? "";
  const toCheck: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === "CheckMacValue") continue;
    toCheck[k] = v;
  }
  const expected = makeCheckMacValue(toCheck);
  const valid = received.toUpperCase() === expected;

  // RtnCode 1 = success (both first auth and each successful period payment)
  const success = payload.RtnCode === "1";

  return {
    valid,
    success,
    userId: payload.CustomField1 ?? "",
    tradeNo: payload.MerchantTradeNo ?? "",
  };
}

// ≤20 char alphanumeric unique order number.
export function makeTradeNo(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `RENO${ts}${rand}`.slice(0, 20).toUpperCase();
}
