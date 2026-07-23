"use client";

import { Suspense, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BookOpen, Clock } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { HomeworkAudioPlayer } from "@/components/shared/homework-audio-player";
import { GradeForm } from "@/app/teacher/follow-up/grade-form";
import type { CapturedError } from "@/lib/domains/progress/types";
import type { TalqeenFilter, TalqeenQueueRow } from "@/lib/views/teacher-talqeen";

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * One Talqeen review row. The captured-error list lives here so the audio
 * player's "Tag error here" button can append a row stamped with the current
 * playback time (#541), pre-filled with the homework's surah/ayah; the grade
 * form edits and submits that same list.
 */
function TalqeenRow({ row }: { row: TalqeenQueueRow }) {
  const [errors, setErrors] = useState<CapturedError[]>([]);
  // Only enable tajweed error-capture when the homework has a real Qur'an
  // location. Inventing 1:1 for a row with no surah/ayah would attach
  // recitation errors to Al-Fatiha:1 — a Quran-integrity violation. (#541 CR)
  const hasLocation = row.surahNumber !== null && row.ayahStart !== null;
  return (
    <>
      <div className="mt-3">
        <HomeworkAudioPlayer
          homeworkId={row.id}
          durationSeconds={row.audioDurationSeconds}
          onTagError={
            hasLocation
              ? (sec) =>
                  setErrors((prev) => [
                    ...prev,
                    { surahNum: row.surahNumber!, ayahNum: row.ayahStart!, errorType: "madd", note: `@${mmss(sec)}` },
                  ])
              : undefined
          }
        />
      </div>
      <div className="mt-3 border-t border-card-border pt-3">
        <GradeForm
          homeworkId={row.id}
          homeworkTitle={row.title}
          errorCapture={
            hasLocation
              ? { errors, onErrorsChange: setErrors, defaults: { surah: row.surahNumber, ayahStart: row.ayahStart } }
              : undefined
          }
        />
      </div>
    </>
  );
}

const FILTERS: { value: TalqeenFilter; ar: string; en: string }[] = [
  { value: "all", ar: "الكل", en: "All" },
  { value: "today", ar: "اليوم", en: "Today" },
  { value: "this-week", ar: "هذا الأسبوع", en: "This week" },
  { value: "overdue", ar: "المتأخرة", en: "Overdue" },
];

function formatRelative(hours: number | null, lang: "ar" | "en"): string {
  if (hours === null) return "—";
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return lang === "ar" ? `قبل ${mins} د` : `${mins}m ago`;
  }
  if (hours < 24) {
    const h = Math.round(hours);
    return lang === "ar" ? `قبل ${h} س` : `${h}h ago`;
  }
  const days = Math.round(hours / 24);
  return lang === "ar" ? `قبل ${days} يوم` : `${days}d ago`;
}

function surahLabel(
  surah: number | null,
  ayahStart: number | null,
  ayahEnd: number | null,
  lang: "ar" | "en",
): string | null {
  if (surah === null) return null;
  const range =
    ayahStart && ayahEnd && ayahEnd !== ayahStart
      ? `${ayahStart}-${ayahEnd}`
      : ayahStart
        ? `${ayahStart}`
        : null;
  return lang === "ar"
    ? range
      ? `سورة ${surah} · آيات ${range}`
      : `سورة ${surah}`
    : range
      ? `Surah ${surah} · ayat ${range}`
      : `Surah ${surah}`;
}

export function TalqeenQueue({
  rows,
  activeFilter,
}: {
  rows: TalqeenQueueRow[];
  activeFilter: TalqeenFilter;
}) {
  return (
    <Suspense fallback={null}>
      <TalqeenQueueInner rows={rows} activeFilter={activeFilter} />
    </Suspense>
  );
}

function TalqeenQueueInner({
  rows,
  activeFilter,
}: {
  rows: TalqeenQueueRow[];
  activeFilter: TalqeenFilter;
}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const langKey: "ar" | "en" = lang === "ar" ? "ar" : "en";

  function applyFilter(filter: TalqeenFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (filter === "all") {
      params.delete("filter");
    } else {
      params.set("filter", filter);
    }
    const query = params.toString();
    startTransition(() => {
      router.push(query ? `/teacher/talqeen?${query}` : "/teacher/talqeen");
    });
  }

  return (
    <div className="mt-6 space-y-4" aria-busy={isPending}>
      <div
        role="tablist"
        aria-label={t("تصفية صندوق التلقين", "Filter talqeen inbox")}
        className="flex flex-wrap gap-2"
      >
        {FILTERS.map((f) => {
          const active = f.value === activeFilter;
          return (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => applyFilter(f.value)}
              className={`min-h-[36px] rounded-full border px-4 py-1.5 text-sm font-medium transition-colors focus-ring ${
                active
                  ? "border-gold/50 bg-gold/15 text-gold"
                  : "border-card-border bg-card/30 text-muted hover:bg-card/50"
              }`}
            >
              {t(f.ar, f.en)}
            </button>
          );
        })}
      </div>

      <ul className="space-y-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`glass-card p-4 sm:p-5 ${row.streakBreakRisk ? "border-error/30" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  <Link
                    href={`/teacher/students/${row.studentId}`}
                    className="hover:text-gold focus-ring"
                  >
                    {row.studentName}
                  </Link>
                </p>
                <p className="text-xs text-muted">{row.title}</p>
                {(() => {
                  const surah = surahLabel(
                    row.surahNumber,
                    row.ayahStart,
                    row.ayahEnd,
                    langKey,
                  );
                  return surah ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-light">
                      <BookOpen size={12} aria-hidden="true" />
                      {surah}
                    </p>
                  ) : null;
                })()}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${
                    row.streakBreakRisk
                      ? "bg-error/10 text-red-400"
                      : "bg-card/40 text-muted-light"
                  }`}
                >
                  {row.streakBreakRisk ? (
                    <AlertTriangle size={12} aria-hidden="true" />
                  ) : (
                    <Clock size={12} aria-hidden="true" />
                  )}
                  {formatRelative(row.hoursSinceReady, langKey)}
                </span>
              </div>
            </div>

            <TalqeenRow row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}
