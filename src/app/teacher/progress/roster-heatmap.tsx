"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, Minus, TrendingUp } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import type { TeacherRosterProgressRow } from "@/lib/teacher-queries";

type SortKey =
  | "name"
  | "composite"
  | "hifz"
  | "tajweed"
  | "fluency"
  | "lastEval";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

function scoreCellClass(score: number | null): string {
  if (score === null) return "bg-card-border/30 text-muted-light";
  if (score >= 4) return "bg-emerald-500/15 text-emerald-300";
  if (score >= 3) return "bg-gold/15 text-gold";
  if (score >= 2) return "bg-warning/15 text-warning";
  return "bg-error/15 text-red-300";
}

function format1(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

function relativeDays(days: number | null, lang: "ar" | "en"): string {
  if (days === null) return lang === "ar" ? "لم يُقيَّم" : "Never";
  if (days === 0) return lang === "ar" ? "اليوم" : "today";
  if (days === 1) return lang === "ar" ? "أمس" : "yesterday";
  return lang === "ar" ? `قبل ${days} يوم` : `${days}d ago`;
}

export function RosterHeatmap({
  rows,
}: {
  rows: TeacherRosterProgressRow[];
}) {
  const { t, lang } = useLang();
  const langKey: "ar" | "en" = lang === "ar" ? "ar" : "en";
  const [sort, setSort] = useState<SortState>({
    key: "composite",
    dir: "asc",
  });

  const sorted = useMemo(() => {
    const numCmp = (a: number | null, b: number | null, dir: "asc" | "desc") => {
      // Nulls always last regardless of dir — treat them as "no data" rather
      // than the worst score (avoids surfacing "Never evaluated" above an
      // actually-failing student).
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return dir === "asc" ? a - b : b - a;
    };
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (sort.key) {
        case "name":
          return sort.dir === "asc"
            ? a.studentName.localeCompare(b.studentName)
            : b.studentName.localeCompare(a.studentName);
        case "composite":
          return numCmp(a.composite, b.composite, sort.dir);
        case "hifz":
          return numCmp(a.hifzAvg, b.hifzAvg, sort.dir);
        case "tajweed":
          return numCmp(a.tajweedAvg, b.tajweedAvg, sort.dir);
        case "fluency":
          return numCmp(a.fluencyAvg, b.fluencyAvg, sort.dir);
        case "lastEval":
          return numCmp(
            a.daysSinceLastEval,
            b.daysSinceLastEval,
            sort.dir === "asc" ? "desc" : "asc",
          );
      }
    });
    return copy;
  }, [rows, sort]);

  function clickSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sort.key !== k)
      return <Minus size={11} className="opacity-30" aria-hidden="true" />;
    return sort.dir === "asc" ? (
      <ArrowUp size={11} aria-hidden="true" />
    ) : (
      <ArrowDown size={11} aria-hidden="true" />
    );
  }

  const atRiskCount = rows.filter((r) => r.atRisk).length;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted">
          {t(
            `${rows.length} طالب · ${atRiskCount} بحاجة لمتابعة`,
            `${rows.length} student${rows.length === 1 ? "" : "s"} · ${atRiskCount} need follow-up`,
          )}
        </span>
        <span className="text-xs text-muted-light">
          {t(
            "الصفّ المركّب = ٠٫٤·حفظ + ٠٫٤·تجويد + ٠٫٢·طلاقة",
            "Composite = 0.4·hifz + 0.4·tajweed + 0.2·fluency",
          )}
        </span>
      </div>

      <div className="glass-card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border text-xs text-muted-light">
              <th className="px-3 py-2 text-start">
                <button
                  type="button"
                  onClick={() => clickSort("name")}
                  className="inline-flex items-center gap-1 font-medium uppercase tracking-wide focus-ring"
                >
                  {t("الطالب", "Student")} <SortIcon k="name" />
                </button>
              </th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => clickSort("composite")}
                  className="inline-flex items-center gap-1 font-medium uppercase tracking-wide focus-ring"
                >
                  {t("مركّب", "Composite")} <SortIcon k="composite" />
                </button>
              </th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => clickSort("hifz")}
                  className="inline-flex items-center gap-1 font-medium uppercase tracking-wide focus-ring"
                >
                  {t("حفظ", "Hifz")} <SortIcon k="hifz" />
                </button>
              </th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => clickSort("tajweed")}
                  className="inline-flex items-center gap-1 font-medium uppercase tracking-wide focus-ring"
                >
                  {t("تجويد", "Tajweed")} <SortIcon k="tajweed" />
                </button>
              </th>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => clickSort("fluency")}
                  className="inline-flex items-center gap-1 font-medium uppercase tracking-wide focus-ring"
                >
                  {t("طلاقة", "Fluency")} <SortIcon k="fluency" />
                </button>
              </th>
              <th className="px-3 py-2 text-end">
                <button
                  type="button"
                  onClick={() => clickSort("lastEval")}
                  className="inline-flex items-center gap-1 font-medium uppercase tracking-wide focus-ring"
                >
                  {t("آخر تقييم", "Last eval")} <SortIcon k="lastEval" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.studentId}
                className={`border-b border-card-border/60 last:border-0 ${
                  row.atRisk ? "bg-error/5" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/teacher/students/${row.studentId}`}
                    className="hover:text-gold focus-ring"
                  >
                    <span className="inline-flex items-center gap-2">
                      {row.atRisk && (
                        <AlertTriangle
                          size={11}
                          className="text-red-400"
                          aria-hidden="true"
                          aria-label={t("بحاجة متابعة", "needs follow-up")}
                        />
                      )}
                      {row.studentName}
                    </span>
                  </Link>
                </td>
                <td
                  className={`px-3 py-2 text-center text-xs font-semibold tabular-nums ${scoreCellClass(row.composite)}`}
                >
                  {format1(row.composite)}
                </td>
                <td
                  className={`px-3 py-2 text-center text-xs tabular-nums ${scoreCellClass(row.hifzAvg)}`}
                >
                  {format1(row.hifzAvg)}
                </td>
                <td
                  className={`px-3 py-2 text-center text-xs tabular-nums ${scoreCellClass(row.tajweedAvg)}`}
                >
                  {format1(row.tajweedAvg)}
                </td>
                <td
                  className={`px-3 py-2 text-center text-xs tabular-nums ${scoreCellClass(row.fluencyAvg)}`}
                >
                  {format1(row.fluencyAvg)}
                </td>
                <td className="px-3 py-2 text-end text-xs text-muted">
                  {relativeDays(row.daysSinceLastEval, langKey)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="flex items-center gap-1 text-[11px] text-muted-light">
        <TrendingUp size={11} aria-hidden="true" />
        {t(
          "ألوان الخلايا: أخضر ≥٤، ذهبي ٣–٤، كهرماني ٢–٣، أحمر <٢. التركيب يستثني الخلايا الخالية.",
          "Cell colors: emerald ≥4, gold 3–4, amber 2–3, red <2. Composite ignores empty cells.",
        )}
      </p>
    </div>
  );
}
