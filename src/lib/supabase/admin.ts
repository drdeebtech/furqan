import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { createObservedFetch } from "./observability";

/**
 * Service-role Supabase client for admin operations (e.g. creating users from scratch).
 * Server-only — no cookies, bypasses RLS.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL");
  }

  return createSupabaseClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    // Sprint 1.1: same silent-fail observability as the regular client.
    // Service-role calls are typically the load-bearing ones (n8n callbacks,
    // bulk admin ops); a silent 4xx here is even more dangerous.
    global: { fetch: createObservedFetch() },
  });
}
