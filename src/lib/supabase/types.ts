import type { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase.generated";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Canonical typed Supabase server client. One source of truth so admin/server
 * action files don't each redeclare `type AnyClient = any` (issue #536) or
 * re-alias `Awaited<ReturnType<typeof createClient>>` (previously duplicated
 * across dashboard-queries.ts and five views/ modules).
 *
 * `createClient()` is async (cookies), so the resolved value is awaited —
 * hence `Awaited<ReturnType<…>>`.
 */
export type ServerClient = Awaited<ReturnType<typeof createClient>>;
export type { Database, SupabaseClient };
