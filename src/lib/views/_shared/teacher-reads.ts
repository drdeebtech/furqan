import { createClient } from "@/lib/supabase/server";

/**
 * Shared read helpers for the teacher deep-read modules
 * (`teacher-insights`, `teacher-inbox`).
 *
 * These exist to kill two duplications that had spread across the
 * teacher reads inside the `dashboard-queries.ts` god module:
 *   - the inline 30-day window string, recomputed in three places, and
 *   - the per-module `public_profiles` name-resolve block (an N+1 when
 *     each caller re-queried it), now collapsed into one tested query.
 */

/**
 * Injected server client type — the test seam. Every read helper takes
 * this as its first argument instead of opening its own `createClient()`,
 * so the read modules can be exercised against a fake/stub client.
 */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * ISO timestamp for the start of a recent rolling window.
 *
 * Replaces the inline `thirtyDaysAgoIso` / `sevenDaysAgoIso` literals
 * that were duplicated across the moved teacher reads. Behavior-identical
 * to the originals: `new Date(Date.now() - days*24h).toISOString()`.
 */
export function recentWindow(days = 30): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Resolve student display names from the `public_profiles` view in ONE
 * query. The single place the talqeen-inbox + parent-digest name-resolve
 * lives (the N+1 fix).
 *
 * Returns a Map of `id -> (full_name ?? "—")`. A missing id is simply
 * absent from the map, so callers do `names.get(id) ?? "—"` to preserve
 * the original "—" fallback for unresolved students. An empty `ids`
 * skips the query and returns an empty Map.
 */
export async function resolveStudentNames(
  supabase: ServerClient,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const profilesRes = await supabase
    .from("public_profiles" as "profiles")
    .select("id, full_name")
    .in("id", ids)
    .returns<{ id: string; full_name: string | null }[]>();
  if (profilesRes.error) throw profilesRes.error;

  const names = new Map<string, string>();
  for (const p of profilesRes.data ?? []) names.set(p.id, p.full_name ?? "—");
  return names;
}
