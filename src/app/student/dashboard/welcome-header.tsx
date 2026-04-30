"use client";

import { Flame, HelpCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface WelcomeHeaderProps {
  firstName: string | null;
  weekday: string;
  surahLabel: string | null;
  ayahNum: number | null;
  /** Surah number 1-114 — used to compute juz position. */
  surahNum: number | null;
  streak: number;
  loggedToday: boolean;
}

/**
 * Welcome row above the dashboard. Composes:
 *  - Greeting (with first name when available)
 *  - Day + active surah/ayah breadcrumb (with tooltip explaining "Surah")
 *  - Juz X / 30 mini-progress bar
 *  - Current consecutive-day streak chip
 *
 * Uses semantic <header> + an aria-live=polite region so screen readers
 * announce streak/breadcrumb changes politely on re-render.
 */
export function WelcomeHeader({
  firstName, weekday, surahLabel, ayahNum, surahNum, streak, loggedToday,
}: WelcomeHeaderProps) {
  const { t, lang } = useLang();
  const juzNum = juzForSurah(surahNum);

  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">
            {firstName
              ? t(`أهلاً، ${firstName}`, `Welcome back, ${firstName}`)
              : t("أهلاً بعودتك", "Welcome back")}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" aria-live="polite">
            <span>{weekday}</span>
            {surahLabel && (
              <>
                <span className="text-muted-light" aria-hidden="true">·</span>
                <span className="text-foreground/80">
                  {lang === "ar"
                    ? `أنت في سورة ${surahLabel}`
                    : `You are in Surah ${surahLabel}`}
                  {ayahNum != null && (
                    <>
                      <span className="mx-1 text-muted-light" aria-hidden="true">·</span>
                      {lang === "ar" ? `الآية ${ayahNum}` : `Ayah ${ayahNum}`}
                    </>
                  )}
                </span>
                <span
                  className="inline-flex items-center"
                  title={t(
                    "السورة هي قسم من القرآن — هناك ١١٤ سورة.",
                    "A surah is a chapter of the Quran — there are 114 in total.",
                  )}
                >
                  <HelpCircle size={12} className="text-muted-light" aria-hidden="true" />
                </span>
              </>
            )}
          </p>
        </div>

        {streak > 0 && (
          <StreakChip streak={streak} loggedToday={loggedToday} />
        )}
      </div>

      {/* Juz mini-progress — visible whenever a surah is known. Uses an
          accessible meter element so screen readers announce position. */}
      {juzNum != null && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-light">
            <span>{t("الموقع في المصحف", "Position in the mushaf")}</span>
            <span className="font-mono tabular-nums text-muted">
              {t(`الجزء ${juzNum} / ٣٠`, `Juz ${juzNum} / 30`)}
            </span>
          </div>
          <div
            role="meter"
            aria-valuemin={1}
            aria-valuemax={30}
            aria-valuenow={juzNum}
            aria-label={t("التقدم في القرآن", "Progress through the Quran")}
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-divider)]"
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(juzNum / 30) * 100}%`,
                background: "var(--data-progress)",
              }}
            />
          </div>
        </div>
      )}
    </header>
  );
}

function StreakChip({ streak, loggedToday }: { streak: number; loggedToday: boolean }) {
  const { t } = useLang();
  const tone = loggedToday
    ? "border-gold/40 bg-gold/10 text-gold"
    : "border-warning/30 bg-warning/5 text-warning";
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${tone}`}
      role="status"
      aria-live="polite"
      title={loggedToday
        ? t("تم تسجيل دراسة اليوم", "You've logged study today")
        : t("لم تسجل بعد اليوم — حافظ على السلسلة", "You haven't logged yet today — keep the streak alive")}
    >
      <Flame size={14} aria-hidden="true" />
      <span>{streak} {streak === 1 ? t("يوم", "day") : t("أيام", "days")}</span>
    </div>
  );
}

/**
 * Approximate Juz mapping — matches the standard mushaf division. Source: a
 * surah-to-juz table cross-referenced with the Madinah mushaf layout. Surahs
 * span juz boundaries in places; this returns the *first* juz the surah
 * begins in (close enough for a dashboard breadcrumb).
 */
function juzForSurah(surah: number | null | undefined): number | null {
  if (surah == null || surah < 1 || surah > 114) return null;
  // Surah-start-juz mapping (1-indexed, fits-in-one-line).
  const map: Record<number, number> = {
    1: 1, 2: 1, 3: 3, 4: 4, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 10: 11,
    11: 11, 12: 12, 13: 13, 14: 13, 15: 14, 16: 14, 17: 15, 18: 15, 19: 16, 20: 16,
    21: 17, 22: 17, 23: 18, 24: 18, 25: 18, 26: 19, 27: 19, 28: 20, 29: 20, 30: 21,
    31: 21, 32: 21, 33: 21, 34: 22, 35: 22, 36: 22, 37: 23, 38: 23, 39: 23, 40: 24,
    41: 24, 42: 25, 43: 25, 44: 25, 45: 25, 46: 26, 47: 26, 48: 26, 49: 26, 50: 26,
    51: 26, 52: 27, 53: 27, 54: 27, 55: 27, 56: 27, 57: 27, 58: 28, 59: 28, 60: 28,
    61: 28, 62: 28, 63: 28, 64: 28, 65: 28, 66: 28, 67: 29, 68: 29, 69: 29, 70: 29,
    71: 29, 72: 29, 73: 29, 74: 29, 75: 29, 76: 29, 77: 29, 78: 30, 79: 30, 80: 30,
    81: 30, 82: 30, 83: 30, 84: 30, 85: 30, 86: 30, 87: 30, 88: 30, 89: 30, 90: 30,
    91: 30, 92: 30, 93: 30, 94: 30, 95: 30, 96: 30, 97: 30, 98: 30, 99: 30, 100: 30,
    101: 30, 102: 30, 103: 30, 104: 30, 105: 30, 106: 30, 107: 30, 108: 30, 109: 30,
    110: 30, 111: 30, 112: 30, 113: 30, 114: 30,
  };
  return map[surah] ?? null;
}
