export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Meta "data deletion request" callback. Contract: respond with a status
// URL + a confirmation code. We store no Threads user data beyond the app's
// own posting token (which lives in env, not the DB), so deletion is a
// no-op — we still return a valid response so Meta accepts the URL.
export async function POST(req: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://zhubao.vercel.app";
  const code = `renoly-${Date.now().toString(36)}`;
  // Meta sends a signed_request form field; we don't need to parse it for a
  // no-op deletion, but consume the body so the request completes cleanly.
  try {
    await req.text();
  } catch {
    /* ignore */
  }
  return new Response(
    JSON.stringify({
      url: `${appUrl}/api/threads/delete?code=${code}`,
      confirmation_code: code,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// Status URL Meta (or the user) can hit to confirm the deletion finished.
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  return new Response(
    JSON.stringify({ status: "completed", confirmation_code: code }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
