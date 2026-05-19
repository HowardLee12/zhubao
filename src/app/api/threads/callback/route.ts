export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Threads OAuth redirect target. Exchanges the code for a short-lived token,
// upgrades it to a ~60-day long-lived token, then shows the token + user id
// for the admin to copy into Vercel env (THREADS_LONG_LIVED_TOKEN /
// THREADS_USER_ID). One-time setup page — remove this route after.

function page(title: string, body: string, ok: boolean) {
  return new Response(
    `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title></head>
<body style="font-family:system-ui;background:#FAF6F0;color:#1A1410;max-width:560px;margin:40px auto;padding:0 20px;line-height:1.6">
<h2 style="color:${ok ? "#2E7D5B" : "#C8462C"}">${title}</h2>${body}
</body></html>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (err) return page("授權失敗", `<p>Threads 回傳錯誤：</p><pre>${err}</pre>`, false);
  if (!code) return page("缺少 code", "<p>沒有收到授權碼，請重開 /api/threads/start</p>", false);

  const appId = process.env.THREADS_APP_ID ?? "";
  const appSecret = process.env.THREADS_APP_SECRET ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!appId || !appSecret) {
    return page("環境變數未設", "<p>THREADS_APP_ID / THREADS_APP_SECRET 尚未在 Vercel 設定。</p>", false);
  }
  const redirectUri = `${appUrl}/api/threads/callback`;

  try {
    // 1) code → short-lived token (+ user_id)
    const form = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });
    const shortRes = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const shortJson = (await shortRes.json()) as {
      access_token?: string;
      user_id?: string | number;
      error?: { message?: string };
      error_message?: string;
    };
    if (!shortRes.ok || !shortJson.access_token) {
      return page(
        "短期 token 交換失敗",
        `<pre>${JSON.stringify(shortJson, null, 2)}</pre>`,
        false
      );
    }

    // 2) short-lived → long-lived (~60d)
    const longUrl = new URL("https://graph.threads.net/access_token");
    longUrl.searchParams.set("grant_type", "th_exchange_token");
    longUrl.searchParams.set("client_secret", appSecret);
    longUrl.searchParams.set("access_token", shortJson.access_token);
    const longRes = await fetch(longUrl.toString());
    const longJson = (await longRes.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: unknown;
    };
    if (!longRes.ok || !longJson.access_token) {
      return page(
        "長期 token 交換失敗",
        `<pre>${JSON.stringify(longJson, null, 2)}</pre>`,
        false
      );
    }

    const days = longJson.expires_in
      ? Math.round(longJson.expires_in / 86400)
      : 60;

    return page(
      "✅ 取得 Threads token 成功",
      `<p>把下面兩個值貼到 <b>Vercel → Environment Variables</b>，然後 Redeploy：</p>
<p style="margin:14px 0 4px;font-weight:600">THREADS_LONG_LIVED_TOKEN</p>
<textarea readonly style="width:100%;height:90px;font-family:monospace;font-size:12px;padding:8px">${longJson.access_token}</textarea>
<p style="margin:14px 0 4px;font-weight:600">THREADS_USER_ID</p>
<input readonly style="width:100%;font-family:monospace;font-size:13px;padding:8px" value="${String(shortJson.user_id ?? "")}"/>
<p style="margin-top:16px;font-size:13px;color:#5A4D40">此 token 約 ${days} 天到期，到期前需 refresh。設定完成後請告知，我會移除這個 /api/threads/* 設定路由。</p>`,
      true
    );
  } catch (e) {
    return page(
      "交換過程發生例外",
      `<pre>${e instanceof Error ? e.message : String(e)}</pre>`,
      false
    );
  }
}
