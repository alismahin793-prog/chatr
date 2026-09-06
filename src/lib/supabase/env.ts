/**
 * Validated public environment for Supabase. Reads NEXT_PUBLIC_* vars.
 * Returns a clear, actionable error if the project has not been configured.
 */
export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      [
        "Supabase is not configured.",
        "Copy .env.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY from your Supabase project settings",
        "(https://supabase.com/dashboard/project/_/settings/api).",
      ].join(" ")
    );
  }
  if (!/^https?:\/\//.test(url)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must start with http(s)://");
  }
  return { url, anonKey };
}