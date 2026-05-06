import Link from "next/link";
import { ArrowLeft, ArrowRight, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { riskBadgeClass, riskLabel } from "@/lib/retention/ui";
import { EmptyCard } from "@/components/shared/empty-card";

interface AtRiskSignal {
  student_id: string;
  churn_risk_score: number | null;
  last_session_at: string | null;
}

interface AtRiskProfile {
  id: string;
  full_name: string | null;
}

export interface ModeratorAtRiskData {
  signals: AtRiskSignal[];
  profiles: AtRiskProfile[];
  dir: "rtl" | "ltr";
}

function daysAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (d === 0) return "اليوم";
  if (d === 1) return "أمس";
  return `قبل ${d} يوم`;
}

/**
 * Pre-fetcher for the at-risk widget. Called from page.tsx inside the
 * page-level Promise.all so the two retention round-trips parallelise
 * with the rest of the dashboard fan-out instead of running sequentially
 * after it. The dependent profiles query still has to wait on signals
 * (it needs the student_id list) — that's a within-helper sequential
 * pair, but it no longer blocks the rest of the page.
 */
export async function fetchModeratorAtRisk(): Promise<{ signals: AtRiskSignal[]; profiles: AtRiskProfile[] }> {
  const supabase = await createClient();
  const { data: signals } = await supabase
    .from("retention_signals")
    .select("student_id, churn_risk_score, last_session_at")
    .gte("churn_risk_score", 60)
    .order("churn_risk_score", { ascending: false })
    .limit(5)
    .returns<AtRiskSignal[]>();

  if (!signals || signals.length === 0) {
    return { signals: [], profiles: [] };
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", signals.map(s => s.student_id))
    .returns<AtRiskProfile[]>();

  return { signals, profiles: profiles ?? [] };
}

/**
 * Moderator-scoped retention widget. Shows top 5 platform-wide at-risk students.
 * Moderators don't own students (no teacher relationship) so scope is global,
 * gated by the moderator role at /admin/retention page view time.
 *
 * Now data-driven (props) so the queries can run inside the page-level
 * Promise.all (see fetchModeratorAtRisk above). Server-renderable.
 */
export function ModeratorAtRiskStudents({ data }: { data: ModeratorAtRiskData }) {
  const { signals, profiles, dir } = data;
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;

  if (signals.length === 0) {
    return (
      <EmptyCard
        variant="celebration"
        title="أحسنت"
        body="لا توجد إشارات تسرب نشطة الآن — التزام الطلاب جيد"
      />
    );
  }

  const nameById = new Map(profiles.map(p => [p.id, p.full_name ?? "بدون اسم"]));

  return (
    <div className="glass-card mt-4 rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingDown size={16} className="text-warning" aria-hidden="true" />
          <h3 className="text-sm font-bold">طلاب في خطر التسرب</h3>
          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">{signals.length}</span>
        </div>
        <Link
          href="/admin/retention"
          className="inline-flex items-center gap-1 text-xs text-gold hover:text-gold-hover"
        >
          <span>عرض الكل</span>
          <Arrow size={12} aria-hidden="true" />
        </Link>
      </div>
      <div className="space-y-2">
        {signals.map(s => {
          const score = s.churn_risk_score ?? 0;
          return (
            <Link
              key={s.student_id}
              href={`/admin/users/${s.student_id}`}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-3 transition-colors hover:border-gold/20"
            >
              <div className="flex items-center gap-3">
                <span className={`glass-badge ${riskBadgeClass(score)}`} title={`${score.toFixed(0)} / 100`}>
                  {riskLabel(score)}
                </span>
                <span className="text-sm font-medium">{nameById.get(s.student_id) ?? "—"}</span>
              </div>
              <span className="text-xs text-muted">آخر جلسة: {daysAgo(s.last_session_at)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
