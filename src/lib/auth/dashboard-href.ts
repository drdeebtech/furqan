import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve the appropriate dashboard URL for a logged-in user, used by
 * routes that live outside a role-specific layout (e.g. /community, /help)
 * to render a "back to dashboard" banner so users don't feel stranded
 * when the sidebar/topbar chrome drops away.
 *
 * Returns null for guests so callers can omit the banner.
 */
export async function getDashboardHref(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: "student" | "teacher" | "admin" | null }>();

  const role = profile?.role;
  if (role === "student") return "/student/dashboard";
  if (role === "teacher") return "/teacher/dashboard";
  if (role === "admin") return "/admin/dashboard";
  return null;
}
