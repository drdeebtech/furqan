import { BookMarked } from "lucide-react";
import { getT } from "@/lib/i18n/server";

/**
 * Recitation-standard roster summary card. Groups the teacher's
 * students by qira'a tradition (hafs/warsh/qalon/al_duri/shu_ba +
 * "unspecified" for the gap).
 *
 * Hidden when the teacher has zero students with progress rows.
 * For multi-tradition rosters: at-a-glance split. For single-
 * tradition rosters: validates the consistency. For students with
 * no recitation_standard set: surfaces the gap as a nudge.
 */

const STANDARD_LABELS: Record<string, { ar: string; en: string }> = {
  hafs: { ar: "حفص عن عاصم", en: "Hafs an Asim" },
  warsh: { ar: "ورش عن نافع", en: "Warsh an Nafi" },
  qalon: { ar: "قالون عن نافع", en: "Qalun an Nafi" },
  al_duri: { ar: "الدوري عن أبي عمرو", en: "Al-Duri an Abu Amr" },
  shu_ba: { ar: "شعبة عن عاصم", en: "Shu'ba an Asim" },
  unspecified: { ar: "غير محدد", en: "Unspecified" },
};

export async function RecitationStandardRoster({
  data,
}: {
  data: { standard: string; count: number }[];
}) {
  const { t, lang } = await getT();
  const langKey: "ar" | "en" = lang === "ar" ? "ar" : "en";

  // Render nothing when there's no roster data — no signal to surface.
  if (data.length === 0) return null;

  const totalStudents = data.reduce((sum, d) => sum + d.count, 0);
  const unspecifiedCount = data.find(d => d.standard === "unspecified")?.count ?? 0;

  return (
    <section
      aria-label={t("توزيع الطلاب حسب القراءة", "Student roster by qira'a")}
      className="mt-4 glass-card p-4 sm:p-5"
    >
      <div className="mb-3 flex items-center gap-2">
        <BookMarked size={18} className="text-gold" aria-hidden="true" />
        <h3 className="font-display text-sm font-semibold">
          {t(
            `طلابك حسب القراءة (${totalStudents})`,
            `Your roster by qira'a (${totalStudents})`,
          )}
        </h3>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {data.map(({ standard, count }) => {
          const label = STANDARD_LABELS[standard]
            ? (langKey === "ar" ? STANDARD_LABELS[standard].ar : STANDARD_LABELS[standard].en)
            : standard;
          const isUnspecified = standard === "unspecified";
          return (
            <span
              key={standard}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                isUnspecified
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-card-border bg-foreground/5 text-foreground/80"
              }`}
            >
              <span className="font-medium">{label}</span>
              <span className="font-mono text-muted">{count}</span>
            </span>
          );
        })}
      </div>

      {unspecifiedCount > 0 && (
        <p className="mt-3 text-[11px] text-muted">
          {t(
            `${unspecifiedCount} طالب${unspecifiedCount > 1 ? "" : ""} بدون قراءة محددة — أضفها في تقدّم الطالب لتظهر هنا.`,
            `${unspecifiedCount} student${unspecifiedCount > 1 ? "s" : ""} with no qira'a recorded — set it in student progress to appear here.`,
          )}
        </p>
      )}
    </section>
  );
}
