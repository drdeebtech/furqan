import { ClipboardList, TriangleAlert } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { helperOrFail } from "@/lib/supabase/load-or-fail";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/shared/skeleton";
import { surahName } from "@/lib/quran/surahs";
import {
  getStudentSessionPrep,
  type StudentSessionPrep,
} from "@/lib/views/teacher-session-prep";
import type { RecitationErrorCategory } from "@/lib/views/teacher-insights";

/**
 * "Session prep" card (GitHub #568) — a deterministic, non-AI query card the
 * teacher sees on `/teacher/sessions/[id]` before teaching. Streams in via
 * <Suspense> so it never blocks the page render; it creates its own
 * cookie-authed client and relies on RLS for scoping (see the read module).
 *
 * Heading is deliberately distinct ("بؤرة الأخطاء" / "Session prep · error focus")
 * from the page's existing synchronous "Pre-session prep" gold box so the two
 * don't collide in Arabic RTL.
 *
 * Ayah NUMBERS only — never renders Quran text. `surahName` is the surah's
 * NAME (e.g. "Al-Baqarah"), a structural label, not scripture.
 */
const CATEGORY_LABELS: Record<RecitationErrorCategory, { ar: string; en: string }> = {
  makharij: { ar: "مخارج الحروف", en: "Makharij" },
  sifat: { ar: "صفات الحروف", en: "Sifat" },
  madd: { ar: "المد", en: "Madd" },
  waqf: { ar: "الوقف", en: "Waqf" },
  ghunna: { ar: "الغُنّة", en: "Ghunna" },
  other: { ar: "أخرى", en: "Other" },
};

const EMPTY: StudentSessionPrep = { topErrorTypes: [], repeatOffenderAyahs: [] };

export async function SessionPrepCard({ studentId }: { studentId: string }) {
  const supabase = await createClient();
  const { data, failed } = await helperOrFail(
    () => getStudentSessionPrep(supabase, studentId),
    EMPTY,
    { route: "teacher-session", widget: "session-prep" },
  );
  const { t, lang } = await getT();

  const hasErrors = data.topErrorTypes.length > 0;
  const hasRepeats = data.repeatOffenderAyahs.length > 0;

  return (
    <section
      aria-label={t("بؤرة الأخطاء", "Session prep · error focus")}
      className="mt-4 glass-card p-4 sm:p-5"
    >
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList size={18} className="text-gold" aria-hidden="true" />
        <h3 className="font-display text-sm font-semibold">
          {t("بؤرة الأخطاء", "Session prep · error focus")}
        </h3>
      </div>

      {failed ? (
        <p className="text-sm text-muted">
          {t(
            "تعذّر تحميل بؤرة الأخطاء الآن. جرّب تحديث الصفحة.",
            "Couldn't load session prep right now. Try refreshing.",
          )}
        </p>
      ) : !hasErrors && !hasRepeats ? (
        <p className="text-sm text-muted">
          {t(
            "لا توجد أخطاء بارزة لهذا الطالب حالياً.",
            "No current focus items for this student.",
          )}
        </p>
      ) : (
        <div className="space-y-4">
          {/* Metric 1 — top-3 error categories, last 90 days */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted">
              {t("أبرز الأخطاء (٩٠ يوماً)", "Top error types (90 days)")}
            </p>
            {hasErrors ? (
              <ul className="flex flex-wrap gap-2">
                {data.topErrorTypes.map(({ category, count }) => (
                  <li
                    key={category}
                    className="glass glass-pill inline-flex items-center gap-2 px-3 py-1 text-xs"
                  >
                    <span className="font-medium">
                      {lang === "ar" ? CATEGORY_LABELS[category].ar : CATEGORY_LABELS[category].en}
                    </span>
                    <span
                      className="font-mono text-gold"
                      aria-label={t(`${count} خطأ`, `${count} errors`)}
                    >
                      {count}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">{t("لا شيء في آخر ٩٠ يوماً.", "None in the last 90 days.")}</p>
            )}
          </div>

          {/* Metric 2 — repeat-offender ayahs, all-time (>= 2 errors) */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
              <TriangleAlert size={13} className="text-amber-400" aria-hidden="true" />
              {t("آيات متكررة الأخطاء (خطآن فأكثر)", "Repeat-offender ayahs (2+ errors)")}
            </p>
            {hasRepeats ? (
              <ul className="flex flex-wrap gap-2">
                {data.repeatOffenderAyahs.map(({ surah, ayah, count }) => (
                  <li
                    key={`${surah}:${ayah}`}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs"
                  >
                    <span className="font-medium text-amber-200">
                      {surahName(surah, lang === "ar" ? "ar" : "en") ?? `${surah}`}
                    </span>
                    {/* Ayah number only — LTR so surah:ayah reads correctly in RTL. */}
                    <span dir="ltr" className="font-mono text-amber-100/90">
                      {surah}:{ayah}
                    </span>
                    <span
                      className="font-mono text-amber-300"
                      aria-label={t(`${count} خطأ`, `${count} errors`)}
                    >
                      ×{count}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">
                {t("لا توجد آيات متكررة الأخطاء.", "No repeat-offender ayahs.")}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function SessionPrepCardSkeleton() {
  return (
    <section className="mt-4 glass-card p-4 sm:p-5" aria-hidden="true">
      <Skeleton className="mb-3 h-5 w-32" />
      <div className="space-y-4">
        <div>
          <Skeleton className="mb-2 h-3 w-40" />
          <div className="flex gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-20 rounded-full" />
            ))}
          </div>
        </div>
        <div>
          <Skeleton className="mb-2 h-3 w-48" />
          <div className="flex gap-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-28 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
