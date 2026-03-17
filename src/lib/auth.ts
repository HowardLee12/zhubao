import { cookies } from "next/headers";

export async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("zhubao_user_id")?.value ?? null;
}
