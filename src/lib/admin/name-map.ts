import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve a list of profile IDs to a `{ id → display name }` map.
 * Used by admin list pages (users, teachers, bookings, sessions) that join
 * domain rows back to a human-readable name.
 *
 * Returns an empty map when `ids` is empty so callers can use `map[id] ?? "—"`
 * unconditionally.
 */
export async function buildNameMap(
  supabase: SupabaseClient,
  ids: readonly string[],
  fallback = "—",
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ids as string[])
    .returns<{ id: string; full_name: string | null }[]>();
  if (!data) return {};
  return Object.fromEntries(data.map((p) => [p.id, p.full_name ?? fallback]));
}
