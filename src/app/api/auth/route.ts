import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { UserRow } from "@/lib/database.types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lineUserId, displayName, pictureUrl } = body as {
      lineUserId: string;
      displayName: string;
      pictureUrl?: string;
    };

    if (!lineUserId || !displayName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Find or create user
    const { data: existing } = await supabase
      .from("users")
      .select("*")
      .eq("line_user_id", lineUserId)
      .single();

    let user: UserRow;

    if (existing) {
      // Update profile info
      const { data: updated, error } = await supabase
        .from("users")
        .update({
          display_name: displayName,
          picture_url: pictureUrl ?? "",
        })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error || !updated) {
        return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
      }
      user = updated as UserRow;
    } else {
      // Create new user
      const { data: created, error } = await supabase
        .from("users")
        .insert({
          line_user_id: lineUserId,
          display_name: displayName,
          picture_url: pictureUrl ?? "",
        })
        .select("*")
        .single();

      if (error || !created) {
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
      }
      user = created as UserRow;
    }

    // Set cookie with user ID
    const response = NextResponse.json({
      id: user.id,
      displayName: user.display_name,
      pictureUrl: user.picture_url,
    });

    response.cookies.set("zhubao_user_id", user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
