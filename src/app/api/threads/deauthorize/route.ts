export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Meta "deauthorize" callback. Fired when a user removes the app's access.
// We run a single-account integration, so there's nothing to clean up —
// just acknowledge so Meta accepts the URL and stops retrying.
export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
