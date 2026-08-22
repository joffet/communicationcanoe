import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Realtime only. This client is used for `channel()`/`removeChannel()` and
 * nothing else - there is no `.from()` or `.rpc()` call left anywhere in the
 * codebase - so it carries no schema generic. It used to be
 * `SupabaseClient<Database>`, where `Database` was a hand-maintained
 * snake_case mirror of every table; that mirror described a query surface no
 * caller uses any more and was deleted. Data access goes through Drizzle
 * (see db.ts).
 */
export type AppSupabaseClient = SupabaseClient;

export function createServiceClient(): AppSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createBrowserClientFromEnv(): AppSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createClient(url, key);
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone.startsWith("+") ? phone : `+${digits}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
