import { verifyCallback } from "@/lib/ecpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OrderResultURL — ECPay POSTs here then the browser lands here after payment.
// Authoritative plan flip happens in /api/ecpay/callback (server-to-server);
// this just bounces the user back to the account page with a status flag.
export async function POST(req: Request) {
  let payload: Record<string, string> = {};
  try {
    const sp = new URLSearchParams(await req.text());
    payload = Object.fromEntries(sp.entries());
  } catch {
    // fall through to generic redirect
  }

  const { success } = verifyCallback(payload);
  const flag = success ? "upgraded" : "failed";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return Response.redirect(`${appUrl}/account?pay=${flag}`, 303);
}

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return Response.redirect(`${appUrl}/account`, 303);
}
