import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { SignJWT } from "jose";
import type { UserRow } from "@/lib/database.types";

const AUTH_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "zhubao-dev-secret-change-in-production"
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accessToken } = body as { accessToken: string };

    if (!accessToken) {
      return NextResponse.json({ error: "Missing access token" }, { status: 400 });
    }

    // Verify access token with LINE
    const verifyRes = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!verifyRes.ok) {
      return NextResponse.json({ error: "Invalid access token" }, { status: 401 });
    }

    // Get user profile from LINE
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      return NextResponse.json({ error: "Failed to get LINE profile" }, { status: 401 });
    }

    const profile = await profileRes.json() as {
      userId: string;
      displayName: string;
      pictureUrl?: string;
    };

    const lineUserId = profile.userId;
    const displayName = profile.displayName;
    const pictureUrl = profile.pictureUrl ?? "";

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

    response.cookies.set("zhubao_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    response.cookies.set("zhubao_logged_in", "1", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
