"use client";

import { useEffect, useState, useTransition } from "react";
import { Play, Square, Trash2, Plus, Sparkles, BookOpen, Repeat, Heart } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { WidgetCard } from "@/components/shared/widget-card";
import {
  startStudySession,
  endStudySession,
  addManualEntry,
  deleteStudyEntry,
} from "@/lib/actions/study-log";

interface OpenSession {
  id: string;
  started_at: string;
  kind: string;
  notes: string | null;
}

interface HistoryRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  kind: string;
  notes: string | null;
}

interface Props {
  openSession: OpenSession | null;
  history: HistoryRow[];
  weekSeconds: number;
}

const KIND_META: Record<string, { ar: string; en: string; icon: React.ElementType }> = {
  solo:   { ar: "فردي",   en: "Solo",   icon: Sparkles },
  review: { ar: "مراجعة", en: "Review", icon: Repeat },
  dhikr:  { ar: "ذكر",    en: "Dhikr",  icon: Heart },
  manual: { ar: "يدوي",   en: "Manual", icon: BookOpen },
};

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TimeTrackerView({ openSession, history, weekSeconds }: Props) {
  const { t, dir, lang } = useLang();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const [selectedKind, setSelectedKind] = useState<string>(openSession?.kind ?? "solo");
  const [manualMinutes, setManualMinutes] = useState("");
  const [manualKind, setManualKind] = useState("manual");
  const [manualNotes, setManualNotes] = useState("");

  // Live tick the stopwatch readout every 1s while a session is open.
  useEffect(() => {
    if (!openSession) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [openSession]);

  const elapsedSeconds = openSession
    ? Math.max(0, Math.floor((now - new Date(openSession.started_at).getTime()) / 1000))
    : 0;

  const handleStart = () => {
    startTransition(async () => {
      const res = await startStudySession(selectedKind);
      if (res.ok) toast.success(t("بدأ التتبع", "Tracking started"));
      else toast.error(res.error ?? t("حدث خطأ", "An error occurred"));
    });
  };

  const handleStop = () => {
    if (!openSession) return;
    startTransition(async () => {
      const res = await endStudySession(openSession.id);
      if (res.ok) toast.success(t("تم الحفظ", "Session saved"));
      else toast.error(res.error ?? t("حدث خطأ", "An error occurred"));
    });
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const mins = Number(manualMinutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      toast.error(t("أدخل عدد دقائق صحيح", "Enter a valid number of minutes"));
      return;
    }
    startTransition(async () => {
      const res = await addManualEntry(mins, manualKind, manualNotes || undefined);
      if (res.ok) {
        toast.success(t("تمت الإضافة", "Entry added"));
        setManualMinutes("");
        setManualNotes("");
      } else {
        toast.error(res.error ?? t("حدث خطأ", "An error occurred"));
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const res = await deleteStudyEntry(id);
      if (res.ok) toast.success(t("تم الحذف", "Entry deleted"));
      else toast.error(res.error ?? t("حدث خطأ", "An error occurred"));
    });
  };

  const kindLabel = (k: string) => {
    const m = KIND_META[k];
    if (!m) return k;
    return t(m.ar, m.en);
  };

  return (
    <div dir={dir} className="mx-auto max-w-[1100px] px-6 py-8 sm:px-8 sm:py-10">
      <h1 className="font-display text-3xl font-bold sm:text-4xl">
        {t("تتبع الوقت", "Time Tracker")}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {t(
          "سجّل وقت دراستك الذاتية ليظهر في تحليلات تقدمك جنبًا إلى جنب مع جلساتك المباشرة.",
          "Log self-study time so it appears in your progress analytics alongside live sessions.",
        )}
      </p>

      {/* Stopwatch */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <WidgetCard title={t("ساعة التوقيت", "Stopwatch")}>
            <div className="flex flex-col items-center gap-6 py-6">
              <div
                className="relative flex h-44 w-44 items-center justify-center rounded-full border-4 border-[var(--surface-divider,#E5E7EB)]"
                style={openSession ? { borderColor: "var(--gold)" } : undefined}
              >
                <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
                  {formatDuration(openSession ? elapsedSeconds : 0)}
                </span>
              </div>

              {!openSession && (
                <>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {Object.keys(KIND_META).filter((k) => k !== "manual").map((k) => {
                      const Icon = KIND_META[k].icon;
                      const active = selectedKind === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setSelectedKind(k)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                            active
                              ? "border-gold bg-gold/10 text-gold"
                              : "border-[var(--surface-border)] text-muted hover:text-foreground"
                          }`}
                        >
                          <Icon size={14} aria-hidden="true" />
                          {kindLabel(k)}
                        </button>
                      );
                    })}
                  </div>
                  {/* Cross-surface affordance: starting a "Review" session
                      writes a study_log row with kind='review' that the
                      dashboard's getStudentMurajaahPlan() reads to mark
                      today's Murajaah done. Without this hint the
                      connection is invisible to the student. */}
                  {selectedKind === "review" && (
                    <p className="-mt-2 text-center text-xs text-muted">
                      {t(
                        "ستُحتسب هذه الجلسة كمراجعة اليوم على لوحتك.",
                        "This session will count as today's Murajaah on your dashboard.",
                      )}
                    </p>
                  )}
                </>
              )}

              {openSession ? (
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={pending}
                  className="glass-danger glass-pill inline-flex items-center gap-2 px-8 py-3 text-base font-semibold text-white transition-colors disabled:opacity-50"
                >
                  <Square size={18} fill="currentColor" />
                  {t("إنهاء وحفظ", "Stop & Save")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={pending}
                  className="glass-success glass-pill inline-flex items-center gap-2 px-8 py-3 text-base font-semibold text-white transition-colors disabled:opacity-50"
                >
                  <Play size={18} fill="currentColor" />
                  {t("ابدأ التتبع", "Start tracking")}
                </button>
              )}

              {openSession && (
                <p className="text-xs text-muted">
                  {kindLabel(openSession.kind)} ·{" "}
                  {new Date(openSession.started_at).toLocaleTimeString(lang === "ar" ? "ar" : "en-US")}
                </p>
              )}
            </div>
          </WidgetCard>
        </div>

        <div className="space-y-6">
          <WidgetCard title={t("هذا الأسبوع", "This week")}>
            <div className="py-2">
              <p className="font-mono text-3xl font-bold tabular-nums">
                {formatDuration(weekSeconds)}
              </p>
              {/* Subtitle picks the unit honestly — saying "0 minutes"
                  beneath "00:00:11" was a tiny but jarring contradiction
                  the audit caught. Show seconds for sub-minute totals,
                  hours for big totals, minutes for the middle range. */}
              <p className="mt-1 text-xs text-muted">
                {weekSeconds < 60
                  ? `${weekSeconds} ${t("ثانية", weekSeconds === 1 ? "second" : "seconds")}`
                  : weekSeconds < 3600
                  ? `${Math.round(weekSeconds / 60)} ${t("دقيقة", weekSeconds < 120 ? "minute" : "minutes")}`
                  : `${(weekSeconds / 3600).toFixed(1)} ${t("ساعة", "hours")}`}
              </p>
            </div>
          </WidgetCard>

          {/* Manual entry */}
          <WidgetCard title={t("إضافة يدوية", "Manual entry")}>
            <form onSubmit={handleManualSubmit} className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  value={manualMinutes}
                  onChange={(e) => setManualMinutes(e.target.value)}
                  placeholder={t("الدقائق", "Minutes")}
                  className="glass-input h-10 flex-1 rounded-lg px-3 text-sm"
                />
                <select
                  value={manualKind}
                  onChange={(e) => setManualKind(e.target.value)}
                  className="glass-input h-10 rounded-lg px-2 text-sm"
                >
                  {Object.keys(KIND_META).map((k) => (
                    <option key={k} value={k}>{kindLabel(k)}</option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
                placeholder={t("ملاحظات (اختياري)", "Notes (optional)")}
                className="glass-input h-10 w-full rounded-lg px-3 text-sm"
              />
              <button
                type="submit"
                disabled={pending}
                className="glass-pill inline-flex w-full items-center justify-center gap-2 border border-[var(--surface-border)] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50"
              >
                <Plus size={14} aria-hidden="true" /> {t("إضافة", "Add entry")}
              </button>
            </form>
          </WidgetCard>
        </div>
      </div>

      {/* History */}
      <div className="mt-8">
        <WidgetCard title={t("السجل الأخير", "Recent log")}>
          {history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              {t("لا توجد سجلات بعد", "No entries yet")}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--surface-divider,#F0F0F2)]">
              {history.map((h) => {
                const Icon = KIND_META[h.kind]?.icon ?? BookOpen;
                return (
                  <li key={h.id} className="flex items-center gap-3 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-light,#F5F5F7)]">
                      <Icon size={14} className="text-muted" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {kindLabel(h.kind)}{h.notes ? ` — ${h.notes}` : ""}
                      </p>
                      <p className="text-xs text-muted">
                        {new Date(h.started_at).toLocaleString(lang === "ar" ? "ar" : "en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-foreground">
                      {formatDuration(h.duration_seconds)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(h.id)}
                      disabled={pending}
                      aria-label={t("حذف", "Delete")}
                      className="rounded p-1 text-muted-light transition-colors hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-40"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </WidgetCard>
      </div>
    </div>
  );
}
