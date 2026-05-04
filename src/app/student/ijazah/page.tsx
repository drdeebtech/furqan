import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Award, CheckCircle2, Circle, BookMarked, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type {
  IjazahPathway,
  IjazahRequirement,
  StudentIjazahProgress,
  StudentIjazahRequirementProgress,
} from "@/types/database";

export const metadata: Metadata = { title: "مسارات الإجازة" };

const STANDARD_LABEL: Record<string, { ar: string; en: string }> = {
  hafs: { ar: "حفص عن عاصم", en: "Hafs an Asim" },
  warsh: { ar: "ورش عن نافع", en: "Warsh an Nafi" },
  qalon: { ar: "قالون عن نافع", en: "Qalun an Nafi" },
  al_duri: { ar: "الدوري عن أبي عمرو", en: "Al-Duri an Abu Amr" },
  shu_ba: { ar: "شعبة عن عاصم", en: "Shu'ba an Asim" },
};

/**
 * Student's view of their ijazah pathway journey. Read-only on this page;
 * teachers verify requirements through their own surface (and admins via
 * /admin/ijazah). The page renders three sections:
 *
 *   1. Currently enrolled pathways (with per-requirement met/unmet)
 *   2. Available pathways (active, not yet enrolled)
 *   3. Empty state when no pathways exist at all (academy hasn't seeded any)
 *
 * Item #14 from the deep pedagogical analysis. Ships before any pathway
 * is defined; the academy creates pathways through /admin/ijazah (separate
 * follow-up). The empty state is the V1 reality.
 */
export default async function StudentIjazahPage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Three parallel queries: enrolments, all active pathways, requirements.
  // Per-requirement progress is a fourth query we can fire in parallel
  // since it doesn't depend on the others (RLS gates by enrolment).
  // The new ijazah_* tables aren't in the generated supabase types yet —
  // we cast both the client and the result rows. Drop after
  // `npm run db:types` regen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [enrolmentsRes, pathwaysRes, requirementsRes, reqProgressRes] = await Promise.all([
    sb.from("student_ijazah_progress")
      .select("*").eq("student_id", user.id)
      .order("enrolled_at", { ascending: false }),
    sb.from("ijazah_pathways")
      .select("*").eq("is_active", true)
      .order("created_at", { ascending: true }),
    sb.from("ijazah_requirements")
      .select("*").order("sequence", { ascending: true }),
    sb.from("student_ijazah_requirement_progress").select("*"),
  ]);

  const enrolments: StudentIjazahProgress[] = enrolmentsRes.data ?? [];
  const pathways: IjazahPathway[] = pathwaysRes.data ?? [];
  const requirements: IjazahRequirement[] = requirementsRes.data ?? [];
  const reqProgress: StudentIjazahRequirementProgress[] = reqProgressRes.data ?? [];

  // Helpers: pathway-by-id, requirements-by-pathway, met-by-(enrolment+req).
  const pathwayMap: Record<string, IjazahPathway> = {};
  for (const p of pathways) pathwayMap[p.id] = p;
  const reqsByPathway: Record<string, IjazahRequirement[]> = {};
  for (const r of requirements) {
    (reqsByPathway[r.pathway_id] ??= []).push(r);
  }
  const metMap: Record<string, StudentIjazahRequirementProgress> = {};
  for (const rp of reqProgress) {
    if (rp.met_at) metMap[`${rp.student_progress_id}:${rp.requirement_id}`] = rp;
  }

  // Available = active pathways the student hasn't enrolled in yet.
  const enrolledPathwayIds = new Set(enrolments.map(e => e.pathway_id));
  const available = pathways.filter(p => !enrolledPathwayIds.has(p.id));

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Award size={24} className="text-gold" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold">{t("مسارات الإجازة", "Ijazah Pathways")}</h1>
          <p className="mt-0.5 text-xs text-muted">
            {t(
              "رحلتك الموثقة نحو الإجازة في القرآن الكريم.",
              "Your verified journey toward formal Quran ijazah.",
            )}
          </p>
        </div>
      </div>

      {/* Empty state — no pathways at all. The academy has not seeded any
          pathways yet; the page is functional but waiting for content. */}
      {pathways.length === 0 && enrolments.length === 0 && (
        <div className="glass-card p-10 text-center">
          <Award size={40} className="mx-auto mb-3 text-muted/40" aria-hidden="true" />
          <p className="text-base font-medium">
            {t("لم تُحدَّد مسارات إجازة بعد", "No ijazah pathways defined yet")}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            {t(
              "الإجازة في القرآن هي توثيق سندك من معلمك إلى رسول الله ﷺ. عند تحديد الأكاديمية لمسارات الإجازة المتاحة، ستظهر هنا لتختار منها.",
              "An ijazah is your formal authorisation in Quran transmission, traceable through your teacher's chain back to the Prophet ﷺ. When the academy defines available pathways, they'll appear here for you to enrol in.",
            )}
          </p>
        </div>
      )}

      {/* Currently enrolled pathways. */}
      {enrolments.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-light">
            {t("مسارك الحالي", "Your current pathway")}
          </h2>
          <ul className="space-y-4">
            {enrolments.map(enrol => {
              const pathway = pathwayMap[enrol.pathway_id];
              if (!pathway) return null;
              const reqs = reqsByPathway[enrol.pathway_id] ?? [];
              const metCount = reqs.filter(r => metMap[`${enrol.id}:${r.id}`]).length;
              const progressPct = reqs.length > 0 ? Math.round((metCount / reqs.length) * 100) : 0;
              const stdLabel = STANDARD_LABEL[pathway.recitation_standard];
              return (
                <li key={enrol.id} className="glass-card overflow-hidden">
                  <div className="border-b border-card-border bg-gold/5 p-4">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-display text-lg font-bold">
                        {lang === "ar" ? pathway.name_ar : pathway.name_en}
                      </h3>
                      {stdLabel && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs text-gold">
                          <BookMarked size={11} aria-hidden="true" />
                          {t(stdLabel.ar, stdLabel.en)}
                        </span>
                      )}
                    </div>
                    {/* Progress bar */}
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted">
                        {metCount} / {reqs.length} {t("متطلباً", "requirements")}
                      </span>
                      <span className="font-mono tabular-nums text-gold">{progressPct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-divider)]">
                      <div
                        className="h-full rounded-full bg-gold transition-all"
                        style={{ width: `${progressPct}%` }}
                        role="meter"
                        aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct}
                      />
                    </div>
                    {enrol.completed_at && (
                      <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs text-success">
                        <CheckCircle2 size={11} aria-hidden="true" />
                        {t(
                          `مُنحت في ${new Date(enrol.completed_at).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" })}`,
                          `Issued ${new Date(enrol.completed_at).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" })}`,
                        )}
                      </p>
                    )}
                  </div>

                  {/* Requirements list */}
                  {reqs.length === 0 ? (
                    <p className="p-4 text-xs text-muted">
                      {t("لم تُحدَّد متطلبات لهذا المسار بعد", "No requirements defined for this pathway yet")}
                    </p>
                  ) : (
                    <ol className="divide-y divide-card-border">
                      {reqs.map(req => {
                        const met = metMap[`${enrol.id}:${req.id}`];
                        return (
                          <li key={req.id} className="flex items-start gap-3 p-3">
                            {met ? (
                              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                            ) : (
                              <Circle size={16} className="mt-0.5 shrink-0 text-muted/40" aria-hidden="true" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm ${met ? "" : "text-foreground/80"}`}>
                                {lang === "ar" ? req.description_ar : req.description_en}
                              </p>
                              {met?.met_at && (
                                <p className="mt-1 text-[11px] text-success">
                                  {t(
                                    `أُنجز في ${new Date(met.met_at).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}`,
                                    `Met on ${new Date(met.met_at).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}`,
                                  )}
                                </p>
                              )}
                            </div>
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-light">
                              #{req.sequence}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Available pathways the student could enrol in. Enrolment itself
          requires teacher or admin action (a one-line schema check makes
          this safe), so for V1 we just show what's available with a
          "Talk to your teacher" copy. Self-enrolment can come later. */}
      {available.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-light">
            {t("مسارات متاحة", "Available pathways")}
          </h2>
          <ul className="space-y-3">
            {available.map(p => {
              const reqs = reqsByPathway[p.id] ?? [];
              const stdLabel = STANDARD_LABEL[p.recitation_standard];
              return (
                <li key={p.id} className="glass-card p-4">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold">
                      {lang === "ar" ? p.name_ar : p.name_en}
                    </h3>
                    {stdLabel && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-card-border bg-card/50 px-2 py-0.5 text-xs text-muted">
                        <BookMarked size={10} aria-hidden="true" />
                        {t(stdLabel.ar, stdLabel.en)}
                      </span>
                    )}
                  </div>
                  {(lang === "ar" ? p.description_ar : p.description_en) && (
                    <p className="text-xs leading-relaxed text-muted">
                      {lang === "ar" ? p.description_ar : p.description_en}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-light">
                    {t(`${reqs.length} متطلباً`, `${reqs.length} requirements`)}
                  </p>
                  <Link
                    href="/student/messages"
                    className="mt-3 inline-flex items-center gap-1 text-xs text-gold hover:text-gold-hover focus-ring rounded"
                  >
                    {t("راسل معلمك للاشتراك", "Message your teacher to enrol")}
                    <ChevronRight size={12} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
