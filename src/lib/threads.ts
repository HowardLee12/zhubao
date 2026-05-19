// Threads API posting helper.
//
// Env (set in Vercel, never commit):
//   THREADS_LONG_LIVED_TOKEN  — ~60-day token from the OAuth helper
//   THREADS_USER_ID           — numeric Threads user id (optional; "me" works)
//
// Publishing is a 2-step flow: create a media container, then publish it.
// Docs: https://developers.facebook.com/docs/threads/posts

const GRAPH = "https://graph.threads.net/v1.0";

function token(): string {
  return process.env.THREADS_LONG_LIVED_TOKEN ?? "";
}
function userId(): string {
  return process.env.THREADS_USER_ID || "me";
}

export function threadsConfigured(): boolean {
  return Boolean(process.env.THREADS_LONG_LIVED_TOKEN);
}

export async function getThreadsProfile(): Promise<
  { ok: true; id: string; username: string } | { ok: false; error: string }
> {
  if (!threadsConfigured()) return { ok: false, error: "THREADS_LONG_LIVED_TOKEN not set" };
  try {
    const url = new URL(`${GRAPH}/me`);
    url.searchParams.set("fields", "id,username");
    url.searchParams.set("access_token", token());
    const res = await fetch(url.toString());
    const json = (await res.json()) as {
      id?: string;
      username?: string;
      error?: { message?: string };
    };
    if (!res.ok || !json.id) {
      return { ok: false, error: json.error?.message || JSON.stringify(json) };
    }
    return { ok: true, id: json.id, username: json.username ?? "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function postToThreads(
  text: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!threadsConfigured()) return { ok: false, error: "THREADS_LONG_LIVED_TOKEN not set" };
  const body = text.trim();
  if (!body) return { ok: false, error: "empty text" };
  // Threads hard limit is 500 chars.
  if (body.length > 500) return { ok: false, error: `text too long (${body.length}/500)` };

  try {
    // 1) create container
    const createUrl = new URL(`${GRAPH}/${userId()}/threads`);
    createUrl.searchParams.set("media_type", "TEXT");
    createUrl.searchParams.set("text", body);
    createUrl.searchParams.set("access_token", token());
    const createRes = await fetch(createUrl.toString(), { method: "POST" });
    const createJson = (await createRes.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (!createRes.ok || !createJson.id) {
      return {
        ok: false,
        error: `create failed: ${createJson.error?.message || JSON.stringify(createJson)}`,
      };
    }

    // Meta recommends a brief wait before publishing.
    await new Promise((r) => setTimeout(r, 3000));

    // 2) publish container
    const pubUrl = new URL(`${GRAPH}/${userId()}/threads_publish`);
    pubUrl.searchParams.set("creation_id", createJson.id);
    pubUrl.searchParams.set("access_token", token());
    const pubRes = await fetch(pubUrl.toString(), { method: "POST" });
    const pubJson = (await pubRes.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (!pubRes.ok || !pubJson.id) {
      return {
        ok: false,
        error: `publish failed: ${pubJson.error?.message || JSON.stringify(pubJson)}`,
      };
    }
    return { ok: true, id: pubJson.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
