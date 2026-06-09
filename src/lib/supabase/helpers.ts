import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fetch a mapping of user IDs to display names from the profiles table.
 * @param supabase  - Supabase client instance
 * @param ids       - Array of profile IDs to resolve
 * @param fallback  - Fallback string when full_name is null (default "—")
 */
export async function fetchNameMap(
  supabase: SupabaseClient,
  ids: string[],
  fallback = "—",
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const unique = [...new Set(ids)];
  // Read from the non-PII `public_profiles` view, not `profiles`: this generic
  // name resolver is called with id sets that aren't always a teacher<->student
  // counterparty of the caller, so the relationship-scoped `profiles` RLS would
  // null out legitimate name lookups. The view exposes id/full_name only.
  const { data } = await supabase
    .from("public_profiles" as "profiles")
    .select("id, full_name")
    .in("id", unique);
  if (!data) return {};
  return Object.fromEntries(
    data.map((p: { id: string; full_name: string | null }) => [
      p.id,
      p.full_name ?? fallback,
    ]),
  );
}
