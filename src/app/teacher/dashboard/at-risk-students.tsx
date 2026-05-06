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
 * Teacher-scoped retention widget. Shows this teacher's own students
 * (from last 90 days of bookings) who have a churn_risk_score >= 60.
 * Read-only — intervention actions remain admin/moderator.
 */
export async function TeacherAtRiskStudents({ teacherId }: Props) {
  const supabase = await createClient();
  const { t, lang } = await getT();

  // eslint-disable-next-line react-hooks/purity -- server component, deterministic per-request
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: bookings } = await supabase
    .from("bookings")
    .select("student_id")
    .eq("teacher_id", teacherId)
    .gte("created_at", since)
    .returns<{ student_id: string }[]>();

  const studentIds = Array.from(new Set((bookings ?? []).map(b => b.student_id)));
  if (studentIds.length === 0) {
    // Pre-data state — teacher hasn't received any bookings in 90d. Quiet
    // onboarding hint rather than `return null` so the dashboard's grid
    // rhythm stays stable + the new teacher gets a "this is where the data
    // will land" cue. (mentorship-card and recitation-standard-roster
    // intentionally still return null — those are admin-paired/signal-driven
    // rather than onboarding-stage.)
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

  const { data: signals } = await supabase
    .from("retention_signals")
    .select("student_id, churn_risk_score, last_session_at, package_remaining")
    .in("student_id", studentIds)
    .gte("churn_risk_score", 60)
    .order("churn_risk_score", { ascending: false })
    .limit(5)
    .returns<Omit<AtRiskRow, "full_name">[]>();

  if (!signals || signals.length === 0) {
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

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", signals.map(s => s.student_id))
    .returns<{ id: string; full_name: string | null }[]>();

  const unnamed = t("بدون اسم", "Unnamed");
  const nameById = new Map((profiles ?? []).map(p => [p.id, p.full_name ?? unnamed]));

  return (
    <div className="glass-card mt-4 rounded-xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <TrendingDown size={16} className="text-warning" />
        <h3 className="text-sm font-bold">{t("طلاب يحتاجون انتباهاً", "Students who need attention")}</h3>
        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">{signals.length}</span>
      </div>
      <div className="space-y-2">
        {signals.map(s => {
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
                <span className="text-sm font-medium">{nameById.get(s.student_id) ?? "—"}</span>
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
