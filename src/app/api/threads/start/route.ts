export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-time admin OAuth kickoff. Visit this URL in a browser logged into the
// Threads account that will post; it redirects to Threads' consent screen.
// After approval Threads redirects back to /api/threads/callback which mints
// the long-lived token.
export async function GET() {
  const appId = process.env.THREADS_APP_ID ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (!appId) {
    return new Response(
      "THREADS_APP_ID not set in env. Set it in Vercel first, then redeploy.",
      { status: 503 }
    );
  }

  const redirectUri = `${appUrl}/api/threads/callback`;
  const authorize = new URL("https://threads.net/oauth/authorize");
  authorize.searchParams.set("client_id", appId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set(
    "scope",
    "threads_basic,threads_content_publish"
  );
  authorize.searchParams.set("response_type", "code");

  return Response.redirect(authorize.toString(), 302);
}
