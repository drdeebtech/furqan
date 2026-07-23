import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { getTeacherRosterProgress } from "@/lib/views/teacher-roster-progress";
import { RosterHeatmap } from "./roster-heatmap";

export const metadata: Metadata = { title: "تقدم الطلاب" };

export default async function TeacherProgressPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rows = await getTeacherRosterProgress(supabase, user.id);

  return (
    <main dir={dir} className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<TrendingUp size={24} className="text-gold" />}
        title={t("تقدم الطلاب", "Roster Progress")}
        subtitle={t(
          "خريطة حرارية مرتبة بالنتيجة المركّبة — من يحتاج متابعة فوريّة، من يزدهر، من توقف.",
          "Heatmap ranked by composite score — who needs immediate follow-up, who's blooming, who's stuck.",
        )}
      />

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            variant="glass-card"
            icon={<TrendingUp size={32} className="text-muted" />}
            message={t("لا يوجد طلاب بعد.", "No students yet.")}
            hint={t(
              "بمجرد أن يحجز طلاب معك وتسجل تقييم الجلسة، ستظهر خريطتهم هنا.",
              "Your roster heatmap will appear here once students book and you record at least one session evaluation.",
            )}
          />
        </div>
      ) : (
        <RosterHeatmap rows={rows} />
      )}
    </main>
  );
}
