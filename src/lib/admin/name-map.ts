import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/logger";
import { resolveStudentNames } from "@/lib/views/_shared/teacher-reads";

/**
 * Resolve a list of profile IDs to a `{ id → display name }` map.
 * Used by admin list pages (users, teachers, bookings, sessions) that join
 * domain rows back to a human-readable name.
 *
 * Returns an empty map when `ids` is empty so callers can use `map[id] ?? "—"`
 * unconditionally.
 *
 * Delegates to the shared `resolveStudentNames` helper (same `public_profiles`
 * read `getTeacherTalqeenInbox`/`getTeacherParentReportDigest` already use) so
 * the codebase has a single name-resolve query instead of two. `fallback`
 * (default "—") replaces `resolveStudentNames`'s hardcoded "—" for a null/
 * missing `full_name` — only `src/app/admin/retention/page.tsx` passes a
 * custom one today (a translated "No name" string), so the param is kept for
 * that caller.
 *
 * `resolveStudentNames` throws on a query error; the original `buildNameMap`
 * returned `{}` instead. Preserved here via try/catch + `logError` so no
 * caller of this widely-used helper (18 call sites) starts throwing.
 */
export async function buildNameMap(
  supabase: SupabaseClient,
  ids: readonly string[],
  fallback = "—",
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  try {
    // `resolveStudentNames` takes `ServerClient` (the app's cookie-bound,
    // Database-typed client); callers here pass the generic
    // `SupabaseClient` type. Both wrap the same @supabase/supabase-js
    // client at runtime — narrowest cast available across the two aliases.
    const names = await resolveStudentNames(
      supabase as unknown as Parameters<typeof resolveStudentNames>[0],
      [...ids],
    );
    const result: Record<string, string> = {};
    for (const id of ids) {
      const name = names.get(id);
      if (name !== undefined) result[id] = name === "—" ? fallback : name;
    }
    return result;
  } catch (error) {
    logError("buildNameMap: name-resolve query failed", error, { idCount: ids.length });
    return {};
  }
}
