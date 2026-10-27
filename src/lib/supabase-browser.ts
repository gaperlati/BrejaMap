/**
 * Browser Supabase client, used only for login (Supabase Auth). Data never goes through it:
 * every read/write is done by our /api routes, and RLS (004_auth_rate_limits_and_moderation.sql)
 * blocks direct table access with the public anon key.
 * Returns null on the server and when NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 * are not set, so the app keeps working without login.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Literal process.env.NEXT_PUBLIC_* reads so Next.js inlines them in the client bundle.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

let client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (typeof window === "undefined" || !url || !anonKey) return null;
  client ??= createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** Current access token (refreshed by the client when needed), or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabaseBrowser();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
