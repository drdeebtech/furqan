"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WifiOff, BookOpen, Clock, RefreshCw } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { readProgressSnapshot, type OfflineProgressSnapshot } from "@/lib/offline/progress-snapshot";

/**
 * Public offline fallback (#527). The service worker serves this page when a
 * student navigates while disconnected. It reads the last progress snapshot
 * from localStorage (written on every online visit to /student/progress) so the
 * student can still see their assigned ayahs, recent progress, and teacher's
 * note mid-memorization. No network, no auth round-trip, no Quran text cached.
 */
export default function OfflinePage() {
  const { t, dir, lang } = useLang();
  // `undefined` = not yet read (SSR + first paint); null = read, but empty.
  // localStorage is client-only, so the one-shot read happens on mount.
  const [snapshot, setSnapshot] = useState<OfflineProgressSnapshot | null | undefined>(undefined);
  const ready = snapshot !== undefined;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of the client-only localStorage snapshot on mount
    setSnapshot(readProgressSnapshot());
  }, []);

  function range(surahFrom: number | null, ayahFrom: number | null, surahTo: number | null, ayahTo: number | null): string {
    if (!surahFrom) return "—";
    const from = ayahFrom ? `${surahFrom}:${ayahFrom}` : `${surahFrom}`;
    const to = surahTo && ayahTo ? `${surahTo}:${ayahTo}` : null;
    return to && to !== from ? `${from} – ${to}` : from;
  }

  const syncedLabel = snapshot
    ? new Date(snapshot.syncedAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-US", { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <main dir={dir} className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
        <WifiOff size={22} className="text-warning" aria-hidden="true" />
        <div>
          <p className="font-semibold">{t("أنت غير متصل بالإنترنت", "You're offline")}</p>
          {syncedLabel && (
            <p className="text-xs text-muted">
              {t("آخر مزامنة", "Last synced")}: {syncedLabel}
            </p>
          )}
        </div>
        <Link
          href="/student/progress"
          className="ms-auto inline-flex items-center gap-1 rounded-full border border-card-border bg-card/40 px-3 py-1.5 text-xs font-medium hover:bg-card/60 focus-ring"
        >
          <RefreshCw size={12} aria-hidden="true" /> {t("إعادة المحاولة", "Retry")}
        </Link>
      </div>

      {!ready ? null : !snapshot ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <BookOpen size={28} className="mx-auto mb-3 text-muted" aria-hidden="true" />
          <p className="text-muted">
            {t(
              "لا توجد بيانات محفوظة بعد. افتح صفحة «تقدمي» مرة واحدة وأنت متصل ليتم حفظها للوضع دون اتصال.",
              "No saved data yet. Open your Progress page once while online to cache it for offline use.",
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {snapshot.assignments.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gold">
                <BookOpen size={15} aria-hidden="true" /> {t("الواجب الحالي", "Current assignments")}
              </h2>
              <ul className="space-y-2">
                {snapshot.assignments.map((a, i) => (
                  <li key={i} className="glass-card rounded-xl p-3">
                    <p className="text-sm font-medium">{a.title}</p>
                    {a.surah && (
                      <p className="mt-0.5 text-xs text-muted">
                        {t("سورة", "Surah")} {range(a.surah, a.ayahStart, a.surah, a.ayahEnd)}
                      </p>
                    )}
                    {a.dueDate && (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-light">
                        <Clock size={11} aria-hidden="true" />
                        {new Date(a.dueDate).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {snapshot.recentProgress.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gold">{t("التقدم الأخير", "Recent progress")}</h2>
              <ul className="space-y-2">
                {snapshot.recentProgress.map((p, i) => (
                  <li key={i} className="glass-card rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{range(p.surahFrom, p.ayahFrom, p.surahTo, p.ayahTo)}</p>
                      <span className="text-xs text-muted">{new Date(p.date).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US")}</span>
                    </div>
                    {p.teacherNotes && <p className="mt-1 text-xs text-muted">{p.teacherNotes}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {snapshot.parentNote && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gold">{t("ملاحظة المعلم", "Teacher's note")}</h2>
              <p className="glass-card rounded-xl p-3 text-sm text-muted">{snapshot.parentNote}</p>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
