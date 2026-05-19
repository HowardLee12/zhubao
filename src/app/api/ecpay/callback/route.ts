import { track } from "@vercel/analytics/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyCallback } from "@/lib/ecpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ECPay server-to-server notification (ReturnURL + PeriodReturnURL).
// Must reply with the literal "1|OK" on success or ECPay keeps retrying.
export async function POST(req: Request) {
  let payload: Record<string, string> = {};
  try {
    const body = await req.text();
    const sp = new URLSearchParams(body);
    payload = Object.fromEntries(sp.entries());
  } catch {
    return new Response("0|ERR", { status: 400 });
  }

  const { valid, success, userId } = verifyCallback(payload);

  if (!valid) {
    // Bad signature — do not trust, do not flip plan.
    return new Response("0|CheckMacValue", { status: 400 });
  }

  if (success && userId) {
    // Push the paid period ~1 month + 3 day grace forward.
    const expires = new Date();
    expires.setDate(expires.getDate() + 34);

    await supabaseAdmin
      .from("users")
      .update({
        plan: "pro",
        plan_expires_at: expires.toISOString(),
      })
      .eq("id", userId);

    void track("upgrade_success").catch(() => {});
  }

  // Acknowledge regardless (we've recorded what we can); ECPay needs 1|OK.
  return new Response("1|OK", { status: 200 });
}
