import { Nav } from "@/components/shared/nav";
import { Topbar } from "@/components/shared/topbar";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";

type Role = "student" | "teacher" | "admin";

// The six spec-028 AI features; any one enabled surfaces the /admin/ai-review gate.
const AI_FLAGS = [
  "ai_coaching_enabled",
  "ai_curriculum_advisor_enabled",
  "ai_matching_advisor_enabled",
  "ai_parent_reports_enabled",
  "ai_risk_classifier_enabled",
  "ai_weakness_detection_enabled",
] as const;

export async function DashboardLayout({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let userName: string | undefined;
  let roles: Role[] = [role];
  if (user) {
    // Try new multi-role shape first; fall back to legacy single-role
    // read if the `roles` column isn't there yet (migration race).
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name, roles")
      .eq("id", user.id)
      .single<{ full_name: string | null; roles: Role[] | null }>();
    if (error) {
      const { data: legacy } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single<{ full_name: string | null }>();
      userName = legacy?.full_name ?? undefined;
    } else {
      userName = data?.full_name ?? undefined;
      if (data?.roles && data.roles.length > 0) roles = data.roles;
    }
  }

  // Capability-gated nav surfaces (capability-surfacing plan §0/§3): dormant
  // Connect payouts (spec 040) and the AI eval gate (spec 028) must not appear
  // before their cutover. getSettings() is globally cached (unstable_cache), so
  // this adds no per-request DB round-trip. Students have no gated links.
  let showConnectPayouts = false;
  let showAiReview = false;
  if (role === "admin" || role === "teacher") {
    const settings = await getSettings();
    showConnectPayouts = (settings["connect_cutover_date"] ?? "").trim() !== "";
    showAiReview = role === "admin" && AI_FLAGS.some((k) => settings[k] === "true");
  }

  return (
    <div className="dashboard-chrome min-h-screen">
      <Nav role={role} userName={userName} showConnectPayouts={showConnectPayouts} showAiReview={showAiReview} />
      <main id="main-content" className="min-h-screen pt-14 md:pt-0 md:ms-64">
        <div className="hidden md:block md:px-6 md:pt-5 md:pb-4">
          <Topbar role={role} roles={roles} />
        </div>
        <div className="dashboard-content-shell">
          {children}
        </div>
      </main>
    </div>
  );
}
