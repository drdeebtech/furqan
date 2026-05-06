"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle,
  Clock,
  Mic,
  Star,
} from "lucide-react";
import Image from "next/image";
import { useLang } from "@/lib/i18n/context";
import { surahName } from "@/lib/quran/surahs";
import type { TeacherRecitationRosterRow } from "@/lib/teacher-queries";
import { requestFreshRecitationAction } from "./actions";

/** Uppercase the first character of a name for the avatar fallback.
 *  Audit finding 2026-05-06: students whose name starts lowercase ("test
 *  student farag") rendered with lowercase initial "t". Always uppercase. */
function avatarInitial(name: string): string {
  const first = name.trim().charAt(0);
  return first ? first.toUpperCase() : "—";
}

function relativeDays(days: number | null, lang: "ar" | "en"): string {
  if (days === null) return lang === "ar" ? "لم يُسجَّل بعد" : "Never recorded";
  if (days === 0) return lang === "ar" ? "اليوم" : "today";
  if (days === 1) return lang === "ar" ? "أمس" : "yesterday";
  return lang === "ar" ? `قبل ${days} يوم` : `${days}d ago`;
}

function qualityStars(avg: number | null): number {
  if (avg === null) return 0;
  return Math.round(avg);
}

function RequestRecitationButton({
  studentId,
}: {
  studentId: string;
}) {
  const { t } = useLang();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    | { kind: "ok"; message: string }
    | { kind: "err"; message: string }
    | null
  >(null);

  function handleClick() {
    setFeedback(null);
    startTransition(async () => {
      const result = await requestFreshRecitationAction(studentId);
      if ("success" in result) {
        setFeedback({
          kind: "ok",
          message: t("تم إرسال الطلب", "Request sent"),
        });
      } else {
        setFeedback({ kind: "err", message: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold/20 disabled:opacity-50 focus-ring"
      >
        <Mic size={12} aria-hidden="true" />
        {isPending
          ? t("جارٍ الإرسال…", "Sending…")
          : t("طلب تلاوة", "Request recitation")}
      </button>
      {feedback && (
        <span
          className={`inline-flex items-center gap-1 text-[11px] ${
            feedback.kind === "ok" ? "text-success" : "text-red-400"
          }`}
          role="status"
        >
          {feedback.kind === "ok" ? (
            <CheckCircle size={11} aria-hidden="true" />
          ) : (
            <AlertTriangle size={11} aria-hidden="true" />
          )}
          {feedback.message}
        </span>
      )}
    </div>
  );
}

export function RecitationRoster({
  rows,
}: {
  rows: TeacherRecitationRosterRow[];
}) {
  const { t, lang } = useLang();
  const langKey: "ar" | "en" = lang === "ar" ? "ar" : "en";

  return (
    <ul className="mt-6 space-y-3">
      {rows.map((row) => {
        const stars = qualityStars(row.qualityAvgLast5);
        // Resolve surah numbers to qira'a names (Al-Fatiha, etc.) via the
        // shared `surahName` helper. Audit caught "Surah 1" instead of the
        // pedagogically-meaningful name.
        const fromName = row.surahFrom
          ? surahName(row.surahFrom, langKey)
          : null;
        const toName = row.surahTo
          ? surahName(row.surahTo, langKey)
          : null;
        const surahLabel =
          row.surahFrom && row.surahTo && row.surahFrom !== row.surahTo
            ? `${fromName ?? row.surahFrom} → ${toName ?? row.surahTo}`
            : row.currentSurah
              ? (toName ?? fromName ?? `${t("سورة", "Surah")} ${row.currentSurah}`)
              : null;
        return (
          <li
            key={row.studentId}
            className={`glass-card p-4 sm:p-5 ${row.streakBreakRisk ? "border-error/30" : ""}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                {row.avatarUrl ? (
                  <Image
                    src={row.avatarUrl}
                    alt=""
                    width={40}
                    height={40}
                    sizes="40px"
                    className="rounded-full"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-sm font-medium text-muted">
                    {avatarInitial(row.studentName)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    <Link
                      href={`/teacher/students/${row.studentId}`}
                      className="underline-offset-4 hover:text-gold hover:underline focus-ring"
                    >
                      {row.studentName}
                    </Link>
                  </p>
                  {surahLabel && (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-light">
                      <BookOpen size={12} aria-hidden="true" />
                      {surahLabel}
                    </p>
                  )}
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted">
                    {row.streakBreakRisk ? (
                      <AlertTriangle
                        size={12}
                        aria-hidden="true"
                        className="text-red-400"
                      />
                    ) : (
                      <Clock size={12} aria-hidden="true" />
                    )}
                    {relativeDays(row.daysSinceLastHeard, langKey)}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                {row.qualityAvgLast5 !== null && (
                  // Stars-only — the numeric "4.0" was dropped (audit caught
                  // it as redundant with the 5-star pictogram). The exact
                  // value still surfaces via aria-label and title for SR
                  // users and on hover.
                  <div
                    className="flex items-center gap-0.5"
                    title={t(
                      `متوسط الجودة ${row.qualityAvgLast5.toFixed(1)} من 5`,
                      `Quality average ${row.qualityAvgLast5.toFixed(1)} of 5`,
                    )}
                    aria-label={t(
                      `متوسط الجودة ${row.qualityAvgLast5.toFixed(1)} من 5`,
                      `Quality average ${row.qualityAvgLast5.toFixed(1)} of 5`,
                    )}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        size={14}
                        className={
                          n <= stars
                            ? "fill-gold text-gold"
                            : "text-muted-light"
                        }
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                )}
                <RequestRecitationButton studentId={row.studentId} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
