import type { Metadata } from "next";
import { headers } from "next/headers";
import { WifiOff, BookMarked, CalendarClock, AlertTriangle, GraduationCap } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { resolveParentToken, getParentPortalView } from "@/lib/domains/parent-portal/tokens";
import { SESSION_TYPE_AR } from "@/lib/constants";

// Never index a private per-child link.
export const metadata: Metadata = { title: "تقرير الطالب", robots: { index: false, follow: false } };

// Platform display timezone — sessions are rendered server-side, so pin an
// explicit zone instead of the server's default (matches teacher/admin dashboards).
const PLATFORM_TZ = "Asia/Kuwait";

const ERROR_TYPE_AR: Record<string, string> = { makharij: "مخارج", sifat: "صفات", madd: "مدّ", waqf: "وقف", ghunna: "غنّة", other: "أخرى" };
const ERROR_TYPE_EN: Record<string, string> = { makharij: "Makharij", sifat: "Sifat", madd: "Madd", waqf: "Waqf", ghunna: "Ghunna", other: "Other" };

interface Props { params: Promise<{ token: string }>; }

export default async function ParentPortalPage({ params }: Props) {
  const { token } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";

  // Per-IP rate limit on this public, unauthenticated route — anti-enumeration.
  const h = await headers();
  const ipKey =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  // Fail-closed: a capability-token route's anti-enumeration guard must DENY on
  // a rate-limit backend error, not admit. (#563 CR)
  const allowed = await checkRateLimit(ipKey, "parent-portal-view", 60, { failClosed: true });

  // Friendly wall — never hints which condition failed (unknown / revoked /
  // expired / rate-limited / transient read error).
  const wall = (
    <main dir={dir} className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <WifiOff size={32} className="mb-4 text-muted" aria-hidden="true" />
      <h1 className="text-lg font-semibold">{t("الرابط غير صالح", "Link not available")}</h1>
      <p className="mt-2 text-sm text-muted">
        {t(
          "انتهت صلاحية هذا الرابط أو تم إلغاؤه. اطلب من المعلّم رابطًا جديدًا.",
          "This link has expired or been revoked. Please ask the teacher for a new one.",
        )}
      </p>
    </main>
  );

  // Fail-closed: unknown / revoked / expired token, rate-limited, or a transient
  // lookup failure → the same wall (resolveParentToken can reject on a DB blip).
  let resolved: Awaited<ReturnType<typeof resolveParentToken>> = null;
  if (allowed) {
    try {
      resolved = await resolveParentToken(token);
    } catch {
      return wall;
    }
  }
  if (!resolved) return wall;

  // getParentPortalView fails closed on a real DB/RLS error (rather than
  // rendering a misleading "no progress" state) — show the same wall.
  let view: Awaited<ReturnType<typeof getParentPortalView>>;
  try {
    view = await getParentPortalView(resolved.studentId);
  } catch {
    return wall;
  }

  return (
    <main dir={dir} className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6 flex items-center gap-3">
        <GraduationCap size={26} className="text-gold" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold">{t(`تقدّم ${view.studentFirstName}`, `${view.studentFirstName}'s progress`)}</h1>
          <p className="text-xs text-muted">{t("آخر 30 يومًا · للعرض فقط", "Last 30 days · read-only")}</p>
        </div>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gold">
          <CalendarClock size={15} aria-hidden="true" /> {t("الجلسات القادمة", "Upcoming sessions")}
        </h2>
        {view.upcomingSessions.length === 0 ? (
          <p className="text-xs text-muted-light">{t("لا توجد جلسات مجدولة.", "No upcoming sessions.")}</p>
        ) : (
          <ul className="space-y-2">
            {view.upcomingSessions.map((s, i) => (
              <li key={i} className="glass-card flex items-center justify-between rounded-xl p-3 text-sm">
                <span>{(lang === "ar" ? SESSION_TYPE_AR[s.sessionType as keyof typeof SESSION_TYPE_AR] : null) ?? s.sessionType} · {s.durationMin} {t("د", "min")}</span>
                <span className="text-xs text-muted">{new Date(s.scheduledAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: PLATFORM_TZ })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gold">
          <BookMarked size={15} aria-hidden="true" /> {t("التقدّم الأخير", "Recent progress")}
        </h2>
        {view.progress.length === 0 ? (
          <p className="text-xs text-muted-light">{t("لا يوجد تقدّم مسجّل بعد.", "No progress recorded yet.")}</p>
        ) : (
          <ul className="space-y-2">
            {view.progress.map((p, i) => (
              <li key={i} className="glass-card rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{p.range}</span>
                  <span className="text-xs text-muted">
                    {p.quality != null ? `${"★".repeat(p.quality)} · ` : ""}
                    {new Date(p.date).toLocaleDateString(locale)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.recentErrors.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gold">
            <AlertTriangle size={15} aria-hidden="true" /> {t("نقاط للتحسين", "Points to improve")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {view.recentErrors.map((e, i) => (
              <li key={i} className="glass-badge rounded-full px-2.5 py-1 text-xs text-muted">
                {lang === "ar" ? ERROR_TYPE_AR[e.errorType] ?? e.errorType : ERROR_TYPE_EN[e.errorType] ?? e.errorType}
                {e.surah ? ` · ${e.surah}:${e.ayah}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t border-card-border pt-4 text-center text-xs text-muted-light">
        {t("فُرقان — منصة تحفيظ القرآن", "FURQAN — Quran memorization")}
      </footer>
    </main>
  );
}
