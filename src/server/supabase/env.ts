interface SupabasePublicEnv {
  url: string;
  anonKey: string;
}

function isPlaceholder(value: string): boolean {
  return value.includes("your-project") || value.startsWith("replace-with-");
}

export function readSupabasePublicEnv(): SupabasePublicEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

  if (!url || !anonKey || isPlaceholder(url) || isPlaceholder(anonKey)) {
    throw new Error("Supabase public environment is not configured.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Supabase URL is invalid.");
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error("Supabase URL must use HTTP or HTTPS.");
  }

  return { url: parsedUrl.toString().replace(/\/$/, ""), anonKey };
}
