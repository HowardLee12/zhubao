import { cookies } from "next/headers";
import { jwtVerify } from "jose";

import { getAuthSigningKey } from "@/lib/auth-key";

export async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("zhubao_session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getAuthSigningKey());
    return (payload.userId as string) ?? null;
  } catch {
    return null;
  }
}
