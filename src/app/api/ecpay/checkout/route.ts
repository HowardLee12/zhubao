import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  ecpayConfigured,
  ECPAY_AIO_URL,
  buildSubscriptionOrder,
  makeTradeNo,
} from "@/lib/ecpay";
import { PRO_PRICE_MONTHLY } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) {
    return new Response("請先登入", { status: 401 });
  }

  if (!ecpayConfigured()) {
    return new Response(
      "金流尚未設定，請聯絡管理員（ECPAY 環境變數未配置）",
      { status: 503 }
    );
  }

  const tradeNo = makeTradeNo();

  // Record the pending trade no so the callback can reconcile.
  await supabase
    .from("users")
    .update({ ecpay_trade_no: tradeNo })
    .eq("id", userId);

  const params = buildSubscriptionOrder({
    userId,
    amount: PRO_PRICE_MONTHLY,
    itemName: `Renoly 專業版 月訂閱 NT$${PRO_PRICE_MONTHLY}`,
    tradeNo,
  });

  // Auto-submitting form → browser navigates to ECPay's hosted cashier.
  const inputs = Object.entries(params)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${k}" value="${String(v)
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")}" />`
    )
    .join("");

  const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"><title>前往付款…</title></head>
<body style="font-family:system-ui;text-align:center;padding-top:80px;color:#5A4D40;background:#FAF6F0">
<div>正在前往綠界付款頁面…</div>
<form id="ecpay" method="post" action="${ECPAY_AIO_URL}">${inputs}</form>
<script>document.getElementById('ecpay').submit();</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
