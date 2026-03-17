import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const AUTH_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "zhubao-dev-secret-change-in-production"
);

export async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("zhubao_session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, AUTH_SECRET);
    return (payload.userId as string) ?? null;
  } catch {
    return null;
  }
}
