import Link from "next/link";
import { TrendingDown, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT, type Lang } from "@/lib/i18n/server";
import { riskBadgeClass, riskLabel } from "@/lib/retention/ui";
import { EmptyCard } from "@/components/shared/empty-card";

interface Props {
  teacherId: string;
}

interface AtRiskRow {
  student_id: string;
  full_name: string;
  churn_risk_score: number | null;
  last_session_at: string | null;
  package_remaining: number | null;
}

function daysAgo(iso: string | null, lang: Lang): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (d === 0) return lang === "ar" ? "اليوم" : "today";
  if (d === 1) return lang === "ar" ? "أمس" : "yesterday";
  return lang === "ar" ? `قبل ${d} يوم` : `${d}d ago`;
}

/**
 * Teacher-scoped retention widget. Shows this teacher's own students who have
 * a churn_risk_score >= 60, ordered by risk descending.
 *
 * Uses the teacher_at_risk_students RPC (S5 scale fix) which pushes the
 * bookings→retention_signals→profiles join + ORDER BY + LIMIT into a single
 * indexed Postgres query, replacing the previous three-step JS aggregation.
 */
export async function TeacherAtRiskStudents({ teacherId }: Props) {
  const supabase = await createClient();
  const { t, lang } = await getT();

  // Cast until db:types regenerates post-migration. Same pattern as other
  // new-RPC calls (e.g. get_teacher_overdue_eval_count in dashboard/page.tsx).
  const { data: atRisk, error } = await (
    supabase
      .rpc("teacher_at_risk_students" as never, { p_teacher_id: teacherId, p_limit: 5 } as never)
      .returns<AtRiskRow[]>() as unknown as Promise<{
        data: AtRiskRow[] | null;
        error: { message: string; code?: string } | null;
      }>
  );

  // A missing RPC (pre-migration env) or student-with-no-bookings case both
  // land here. Surface the EmptyCard so the dashboard grid stays stable.
  if (error || !atRisk) {
    return (
      <EmptyCard
        variant="quiet"
        title={t("لا توجد بيانات طلاب بعد", "No student data yet")}
        body={t(
          "ستظهر مؤشرات احتفاظ الطلاب هنا بعد أن تبدأ في استقبال الحجوزات",
          "Student retention signals will appear here once you start receiving bookings",
        )}
      />
    );
  }

  if (atRisk.length === 0) {
    return (
      <EmptyCard
        variant="celebration"
        title={t("أحسنت", "Well done")}
        body={t(
          "جميع طلابك ضمن نطاق الالتزام الجيد — لا حاجة لانتباه إضافي الآن",
          "All your students are engaged — no extra attention needed right now",
        )}
      />
    );
  }

  return (
    <div className="glass-card mt-4 rounded-xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <TrendingDown size={16} className="text-warning" />
        <h3 className="text-sm font-bold">{t("طلاب يحتاجون انتباهاً", "Students who need attention")}</h3>
        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">{atRisk.length}</span>
      </div>
      <div className="space-y-2">
        {atRisk.map(s => {
          const score = s.churn_risk_score ?? 0;
          return (
            <Link
              key={s.student_id}
              href={`/teacher/students/${s.student_id}`}
              className="flex items-center justify-between rounded-lg border border-foreground/5 bg-foreground/[0.02] p-3 transition-colors hover:border-gold/20"
            >
              <div className="flex items-center gap-3">
                <span className={`glass-badge ${riskBadgeClass(score)}`} title={`${score.toFixed(0)} / 100`}>
                  {riskLabel(score)}
                </span>
                <span className="text-sm font-medium">{s.full_name || t("بدون اسم", "Unnamed")}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted">
                <span>{t("آخر جلسة:", "Last session:")} {daysAgo(s.last_session_at, lang)}</span>
                {s.package_remaining !== null && s.package_remaining <= 2 && (
                  <span className="flex items-center gap-1 text-warning">
                    <AlertTriangle size={12} /> {t(`${s.package_remaining} جلسة`, `${s.package_remaining} session${s.package_remaining === 1 ? "" : "s"}`)}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">
        {t(
          "اعرض تقدمهم واضبط وتيرة الجلسة. فريق الإدارة يتابع التواصل الخارجي.",
          "Review their progress and adjust the session pace. Admin handles outbound contact.",
        )}
      </p>
    </div>
  );
}
