import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Users, GraduationCap, DollarSign, TrendingDown, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { helperOrFail } from "@/lib/supabase/load-or-fail";
import { EmptyState } from "@/components/shared/empty-state";
import {
  getActiveUserCounts,
  getTeacherCompletionRates,
  type ActiveUserCounts,
} from "@/lib/views/admin-analytics";

export const metadata: Metadata = { title: "التحليلات" };

const ROUTE = "admin-analytics";

const EMPTY_COUNTS: ActiveUserCounts = {
  students: { dau: 0, wau: 0, mau: 0 },
  teachers: { dau: 0, wau: 0, mau: 0 },
  capped: false,
};

function pct(rate: number | null): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

function rateTone(rate: number | null): string {
  if (rate == null) return "text-muted";
  if (rate < 0.6) return "text-error";
  if (rate < 0.8) return "text-warning";
  return "text-success";
}

export default async function AdminAnalyticsPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();

  // The two metric reads are independent — run them concurrently so the
  // slower one doesn't gate the other. Each keeps its own helperOrFail
  // wrapper/fallback/widget tag, so downstream `.data`/`.failed` shapes match.
  const [activeLoad, completionLoad] = await Promise.all([
    helperOrFail(
      () => getActiveUserCounts(supabase),
      EMPTY_COUNTS,
      { route: ROUTE, widget: "active-users" },
    ),
    helperOrFail(
      () => getTeacherCompletionRates(supabase),
      [],
      { route: ROUTE, widget: "completion-rates" },
    ),
  ]);

  const counts = activeLoad.data;
  const completion = completionLoad.data;
  const anyFailed = activeLoad.failed || completionLoad.failed;

  const activeRows: { label: string; icon: React.ReactNode; row: { dau: number; wau: number; mau: number } }[] = [
    { label: t("الطلاب النشطون", "Active students"), icon: <Users size={18} className="text-muted" />, row: counts.students },
    { label: t("المعلّمون النشطون", "Active teachers"), icon: <GraduationCap size={18} className="text-muted" />, row: counts.teachers },
  ];

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <BarChart3 size={24} className="text-gold" /> {t("التحليلات", "Analytics")}
        </h1>
        <div className="flex items-center gap-2 text-xs">
          <Link href="/admin/dashboard" className="flex items-center gap-1 rounded-lg border border-[var(--surface-border)] bg-surface px-3 py-1.5 text-muted transition-colors hover:text-foreground">
            <DollarSign size={14} /> {t("الإيرادات", "Revenue")}
          </Link>
          <Link href="/admin/retention" className="flex items-center gap-1 rounded-lg border border-[var(--surface-border)] bg-surface px-3 py-1.5 text-muted transition-colors hover:text-foreground">
            <TrendingDown size={14} /> {t("مخاطر التسرب", "Churn risk")}
          </Link>
        </div>
      </div>

      {anyFailed && (
        <div role="alert" className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          {t("تعذّر تحميل بعض المؤشرات. حدّث الصفحة أو حاول لاحقًا.", "Some metrics failed to load. Refresh or try again later.")}
        </div>
      )}

      {/* Active users (DAU/WAU/MAU) — the gap analytics didn't already cover. */}
      <section aria-labelledby="active-heading" className="mb-8">
        <h2 id="active-heading" className="mb-3 text-sm font-medium text-muted">
          {t("المستخدمون النشطون (حصص حضرت فعليًا)", "Active users (delivered sessions)")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {activeRows.map(({ label, icon, row }) => (
            <div key={label} className="rounded-xl glass-card p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium">{icon} {label}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {([
                  { k: t("يومي", "DAU"), v: row.dau },
                  { k: t("أسبوعي", "WAU"), v: row.wau },
                  { k: t("شهري", "MAU"), v: row.mau },
                ] as const).map(({ k, v }) => (
                  <div key={k}>
                    <p className="text-2xl font-bold text-foreground">{v}</p>
                    <p className="text-xs text-muted">{k}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {counts.capped && (
          <p className="mt-2 text-xs text-warning">
            {t("⚠ بلغ عدد الحصص الحد الأقصى للعدّ — الأرقام حدّ أدنى وليست دقيقة.", "⚠ Session volume hit the count cap — figures are a floor, not exact.")}
          </p>
        )}
      </section>

      {/* Cross-teacher completion rate — the other gap. */}
      <section aria-labelledby="completion-heading">
        <h2 id="completion-heading" className="mb-3 text-sm font-medium text-muted">
          {t("معدّل إتمام الحصص لكل معلّم (آخر ٣٠ يومًا)", "Session completion rate by teacher (last 30 days)")}
        </h2>
        {completion.length === 0 ? (
          <EmptyState
            variant="glass-card"
            icon={<Inbox size={32} className="text-muted" aria-hidden="true" />}
            message={t("لا توجد حصص في هذه الفترة", "No sessions in this period")}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl glass-card">
            <table className="w-full text-sm">
              <thead><tr className="glass-thead">
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("المعلّم", "Teacher")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("مكتملة", "Completed")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("مجدولة", "Scheduled")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("المعدّل", "Rate")}</th>
              </tr></thead>
              <tbody>
                {completion.map((r) => (
                  <tr key={r.teacherId} className="border-b border-white/10 last:border-b-0">
                    <td className="px-3 py-3">{r.teacherName}</td>
                    <td className="px-3 py-3 text-muted">{r.completed}</td>
                    <td className="px-3 py-3 text-muted">{r.scheduled}</td>
                    <td className={`px-3 py-3 font-medium ${rateTone(r.rate)}`}>{pct(r.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">
          {t(
            "المعدّل = الحصص المكتملة ÷ (المكتملة + المتغيّب عنها + المؤكَّدة). يُستثنى الملغى وغير المستحق.",
            "Rate = completed ÷ (completed + no-show + confirmed). Cancelled and not-yet-due are excluded.",
          )}
        </p>
      </section>
    </div>
  );
}
