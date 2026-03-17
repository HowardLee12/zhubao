import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { SignJWT } from "jose";
import type { UserRow } from "@/lib/database.types";

const AUTH_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "zhubao-dev-secret-change-in-production"
);

const LINE_CHANNEL_ID = process.env.NEXT_PUBLIC_LIFF_ID?.split("-")[0] ?? "";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { idToken } = body as { idToken: string };

    if (!idToken) {
      return NextResponse.json({ error: "Missing ID token" }, { status: 400 });
    }

    // Verify LINE ID token server-side
    const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id_token: idToken,
        client_id: LINE_CHANNEL_ID,
      }),
    });

    if (!verifyRes.ok) {
      return NextResponse.json({ error: "Invalid LINE token" }, { status: 401 });
    }

    const lineProfile = await verifyRes.json() as {
      sub: string;
      name: string;
      picture?: string;
    };

    const lineUserId = lineProfile.sub;
    const displayName = lineProfile.name;
    const pictureUrl = lineProfile.picture ?? "";

    // Find or create user
    const { data: existing } = await supabase
      .from("users")
      .select("*")
      .eq("line_user_id", lineUserId)
      .single();

    let user: UserRow;

    if (existing) {
      const { data: updated, error } = await supabase
        .from("users")
        .update({ display_name: displayName, picture_url: pictureUrl })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error || !updated) {
        return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
      }
      user = updated as UserRow;
    } else {
      const { data: created, error } = await supabase
        .from("users")
        .insert({
          line_user_id: lineUserId,
          display_name: displayName,
          picture_url: pictureUrl,
        })
        .select("*")
        .single();

      if (error || !created) {
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
      }
      user = created as UserRow;
    }

    // Create signed JWT session token
    const sessionToken = await new SignJWT({ userId: user.id })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .sign(AUTH_SECRET);

    const response = NextResponse.json({
      id: user.id,
      displayName: user.display_name,
      pictureUrl: user.picture_url,
    });

    // Signed httpOnly cookie
    response.cookies.set("zhubao_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    // Client-side flag cookie (no sensitive data)
    response.cookies.set("zhubao_logged_in", "1", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
