import { createClient } from "@supabase/supabase-js";

/** Anon Supabase client for Realtime presence/broadcast only (no Supabase Auth). */
export function createRealtimeClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
