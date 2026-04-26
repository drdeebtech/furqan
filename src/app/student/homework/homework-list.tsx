"use client";

import { useState } from "react";
import { BookOpen, CheckCircle, Clock, AlertTriangle, RefreshCw } from "lucide-react";
import { markStudentReady } from "@/lib/actions/homework";
import { HOMEWORK_TYPE_AR, HOMEWORK_STATUS_STYLE } from "@/lib/constants";
import { useLang } from "@/lib/i18n/context";
import type { HomeworkAssignment } from "@/types/database";

export function HomeworkList({
  assignments,
  nameMap,
}: {
  assignments: HomeworkAssignment[];
  nameMap: Record<string, string>;
}) {
  const { t } = useLang();

  const pending = assignments.filter(a => a.status === "assigned");
  const ready = assignments.filter(a => a.status === "student_ready");
  const completed = assignments.filter(a => a.status.startsWith("completed_"));

  return (
    <div className="space-y-8">
      {/* Pending — student needs to mark ready */}
      {pending.length > 0 && (
        <Section
          title={t("واجبات جديدة", "New Assignments")}
          subtitle={t("اضغط 'أنا جاهز' عند إتمام الحفظ", "Click 'I'm Ready' when done")}
          icon={<AlertTriangle size={18} className="text-blue-400" />}
          count={pending.length}
        >
          {pending.map(a => (
            <HomeworkCard key={a.id} hw={a} nameMap={nameMap} t={t} showReadyButton />
          ))}
        </Section>
      )}

      {/* Ready — waiting for teacher grading */}
      {ready.length > 0 && (
        <Section
          title={t("بانتظار التسميع", "Awaiting Grading")}
          subtitle={t("معلمك سيراجع أداءك في الجلسة القادمة", "Your teacher will review in the next session")}
          icon={<Clock size={18} className="text-amber-400" />}
          count={ready.length}
        >
          {ready.map(a => (
            <HomeworkCard key={a.id} hw={a} nameMap={nameMap} t={t} />
          ))}
        </Section>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <Section
          title={t("واجبات مكتملة", "Completed Homework")}
          icon={<CheckCircle size={18} className="text-emerald-400" />}
          count={completed.length}
        >
          {completed.map(a => (
            <HomeworkCard key={a.id} hw={a} nameMap={nameMap} t={t} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  icon,
  count,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-semibold">{title}</h2>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-muted">{count}</span>
        </div>
        {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function HomeworkCard({
  hw,
  nameMap,
  t,
  showReadyButton,
}: {
  hw: HomeworkAssignment;
  nameMap: Record<string, string>;
  t: (ar: string, en: string) => string;
  showReadyButton?: boolean;
}) {
  const { lang } = useLang();
  const locale = lang === "ar" ? "ar" : "en-US";
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const style = HOMEWORK_STATUS_STYLE[hw.status];
  const teacherName = nameMap[hw.teacher_id] ?? t("معلم", "Teacher");

  async function handleReady() {
    setMarking(true);
    setError(null);
    const result = await markStudentReady(hw.id);
    if ("error" in result && result.error) {
      setError(result.error);
    } else {
      setMarked(true);
    }
    setMarking(false);
  }

  return (
    <div className="glass-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs ${style.className}`}>
              {style.label}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-muted">
              {HOMEWORK_TYPE_AR[hw.homework_type]}
            </span>
          </div>

          <h3 className="text-sm font-semibold">{hw.title}</h3>

          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <span>{teacherName}</span>
            {hw.surah_number && (
              <>
                <span>·</span>
                <span>
                  {t("سورة", "Surah")} {hw.surah_number}
                  {hw.ayah_start && ` (${hw.ayah_start}${hw.ayah_end ? `-${hw.ayah_end}` : ""})`}
                </span>
              </>
            )}
            {hw.pages_count && (
              <>
                <span>·</span>
                <span>{hw.pages_count} {t("صفحات", "pages")}</span>
              </>
            )}
            {hw.due_date && (
              <>
                <span>·</span>
                <span>{t("استحقاق", "Due")}: {new Date(hw.due_date).toLocaleDateString(locale)}</span>
              </>
            )}
          </div>

          {hw.description && <p className="text-xs text-muted/70">{hw.description}</p>}

          {/* Teacher feedback for graded homework */}
          {hw.teacher_notes && (
            <div className="mt-2 rounded-lg border border-gold/20 bg-gold/5 p-2">
              <p className="text-xs text-gold/80">💬 {t("ملاحظات المعلم", "Teacher feedback")}: {hw.teacher_notes}</p>
            </div>
          )}

          {/* Re-assigned indicator */}
          {hw.parent_assignment_id && (
            <div className="flex items-center gap-1 text-xs text-orange-400">
              <RefreshCw size={12} />
              {t("واجب مُعاد — حاول مجدداً", "Re-assigned — try again")}
            </div>
          )}
        </div>

        {/* Ready button */}
        {showReadyButton && !marked && (
          <div className="shrink-0">
            {error && <p className="mb-1 text-xs text-error">{error}</p>}
            <button
              onClick={handleReady}
              disabled={marking}
              className="flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-4 py-2 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {marking ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
              ) : (
                <BookOpen size={16} />
              )}
              {t("أنا جاهز", "I'm Ready")}
            </button>
          </div>
        )}

        {/* Marked confirmation */}
        {marked && (
          <div className="flex items-center gap-1 text-sm text-emerald-400">
            <CheckCircle size={16} />
            {t("تم! بانتظار المعلم", "Done! Awaiting teacher")}
          </div>
        )}
      </div>
    </div>
  );
}
