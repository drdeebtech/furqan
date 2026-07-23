import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { getTeacherTeachingHours } from "@/lib/views/teacher-hours";
import { TeachingHoursView } from "./teaching-hours-view";

export const metadata: Metadata = { title: "ساعاتي" };

export default async function TeacherTimeTrackerPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const summary = await getTeacherTeachingHours(supabase, user.id);
  const empty = summary.thisMonthMinutes === 0;

  return (
    <main dir={dir} className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Clock size={24} className="text-gold" />}
        title={t("ساعاتي", "Teaching Hours")}
        subtitle={t(
          "إجمالي وقت التدريس مأخوذ من الجلسات المكتملة فعلياً، ليس مؤقتاً ذاتياً.",
          "Total teaching time, derived from actually-completed sessions — not a self-logged stopwatch.",
        )}
      />

      {empty ? (
        <div className="mt-6">
          <EmptyState
            variant="glass-card"
            icon={<Clock size={32} className="text-muted" />}
            message={t(
              "لا توجد جلسات مكتملة في آخر ٣٠ يوماً.",
              "No completed sessions in the last 30 days.",
            )}
            hint={t(
              "بمجرد أن تنتهي جلستك الأولى وتسجل وقت بدئها وانتهائها، ستظهر ساعاتك هنا.",
              "Your hours will appear here as soon as you complete a session with a recorded start and end.",
            )}
          />
        </div>
      ) : (
        <TeachingHoursView
          thisWeekMinutes={summary.thisWeekMinutes}
          thisMonthMinutes={summary.thisMonthMinutes}
          byTypeThisMonth={summary.byTypeThisMonth}
          daily={summary.daily}
        />
      )}
    </main>
  );
}
