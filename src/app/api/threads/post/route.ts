import { getUserId } from "@/lib/auth";
import { getThreadsProfile, postToThreads } from "@/lib/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner-only. Single-admin internal tool; the owner's user id is the one
// that's been operating this project throughout. Overridable via env.
const OWNER_USER_ID =
  process.env.OWNER_USER_ID || "37dd5e09-de66-439d-a052-030f6671ba11";

async function requireOwner(): Promise<Response | null> {
  const uid = await getUserId();
  if (!uid) return new Response("請先登入", { status: 401 });
  if (uid !== OWNER_USER_ID) return new Response("forbidden", { status: 403 });
  return null;
}

// GET = verify the Threads token works (returns username, no secrets).
export async function GET() {
  const gate = await requireOwner();
  if (gate) return gate;

  const profile = await getThreadsProfile();
  return new Response(JSON.stringify(profile), {
    status: profile.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
}

// POST { text } = publish a Threads post.
export async function POST(req: Request) {
  const gate = await requireOwner();
  if (gate) return gate;

  let text = "";
  try {
    const body = (await req.json()) as { text?: string };
    text = body.text ?? "";
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await postToThreads(text);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
}
