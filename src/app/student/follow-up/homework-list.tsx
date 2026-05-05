"use client";

import { useState } from "react";
import { BookOpen, CheckCircle, Clock, AlertTriangle, RefreshCw, Mic } from "lucide-react";
import { markStudentReady } from "@/lib/actions/homework";
import { HOMEWORK_TYPE_AR, HOMEWORK_STATUS_STYLE } from "@/lib/constants";
import { useLang } from "@/lib/i18n/context";
import type { HomeworkAssignment } from "@/types/database";
import { AudioRecorder } from "./audio-recorder";

type ParentInfo = {
  id: string;
  status: string;
  teacher_notes: string | null;
  completed_at: string | null;
  title: string;
};

export function HomeworkList({
  assignments,
  nameMap,
  parentMap,
  studentId,
}: {
  assignments: HomeworkAssignment[];
  nameMap: Record<string, string>;
  parentMap?: Record<string, ParentInfo>;
  studentId: string;
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
            <HomeworkCard
              key={a.id}
              hw={a}
              nameMap={nameMap}
              parent={a.parent_assignment_id ? parentMap?.[a.parent_assignment_id] : undefined}
              studentId={studentId}
              t={t}
              showReadyButton
            />
          ))}
        </Section>
      )}

      {/* Ready — waiting for teacher grading */}
      {ready.length > 0 && (
        <Section
          title={t("بانتظار التسميع", "Awaiting Grading")}
          subtitle={t("معلمك سيراجع أداءك في الجلسة القادمة", "Your teacher will review in the next session")}
          icon={<Clock size={18} className="text-warning" />}
          count={ready.length}
        >
          {ready.map(a => (
            <HomeworkCard
              key={a.id}
              hw={a}
              nameMap={nameMap}
              parent={a.parent_assignment_id ? parentMap?.[a.parent_assignment_id] : undefined}
              studentId={studentId}
              t={t}
            />
          ))}
        </Section>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <Section
          title={t("واجبات مكتملة", "Completed Homework")}
          icon={<CheckCircle size={18} className="text-success" />}
          count={completed.length}
        >
          {completed.map(a => (
            <HomeworkCard
              key={a.id}
              hw={a}
              nameMap={nameMap}
              parent={a.parent_assignment_id ? parentMap?.[a.parent_assignment_id] : undefined}
              studentId={studentId}
              t={t}
            />
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

// Translates the original homework's grade into student-facing copy that
// frames the re-attempt as a coaching loop rather than a rebuke. The status
// strings come from HomeworkStatus enum (homework_assignments.status).
const PRIOR_GRADE_COPY: Record<string, { ar: string; en: string }> = {
  completed_needs_work: {
    ar: "تم تقييمها سابقاً: تحتاج تحسين",
    en: "Previously graded: needs work",
  },
  completed_not_done: {
    ar: "لم تُسلَّم سابقاً",
    en: "Previously not turned in",
  },
};

function HomeworkCard({
  hw,
  nameMap,
  parent,
  studentId,
  t,
  showReadyButton,
}: {
  hw: HomeworkAssignment;
  nameMap: Record<string, string>;
  parent?: ParentInfo;
  studentId: string;
  t: (ar: string, en: string) => string;
  showReadyButton?: boolean;
}) {
  const { lang } = useLang();
  const locale = lang === "ar" ? "ar" : "en-US";
  const [recording, setRecording] = useState(false);
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const style = HOMEWORK_STATUS_STYLE[hw.status];
  const teacherName = nameMap[hw.teacher_id] ?? t("معلم", "Teacher");

  async function handleReadyWithoutAudio() {
    setMarking(true);
    setError(null);
    const result = await markStudentReady(hw.id);
    if ("error" in result && result.error) {
      setError(result.error);
    } else {
      setMarked(true);
      setRecording(false);
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

          {/* Re-attempt context — when this homework was auto-regenerated
              from a prior attempt, show the prior grade + teacher's notes so
              the student understands what to fix this time. Frames the
              regeneration as a coaching loop, not a rebuke. */}
          {hw.parent_assignment_id && (
            <div className="mt-1 rounded-lg border border-warning/30 bg-warning/5 p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <RefreshCw size={12} aria-hidden="true" />
                {t("محاولة جديدة", "Re-attempt")}
                {parent?.completed_at && (
                  <span className="font-normal text-muted">
                    · {t("الأصل", "Original")} {new Date(parent.completed_at).toLocaleDateString(locale, { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
              {parent && PRIOR_GRADE_COPY[parent.status] && (
                <p className="mt-1 text-xs text-foreground/80">
                  {t(PRIOR_GRADE_COPY[parent.status].ar, PRIOR_GRADE_COPY[parent.status].en)}
                </p>
              )}
              {parent?.teacher_notes && (
                <p className="mt-1 text-xs leading-relaxed text-foreground/90">
                  <span className="text-warning/90">{t("ملاحظة المعلم في المرة السابقة:", "Teacher's note last time:")}</span>{" "}
                  {parent.teacher_notes}
                </p>
              )}
              {!parent && (
                <p className="mt-0.5 text-xs text-muted">
                  {t("هذا الواجب أُعيد بناءً على المحاولة السابقة. حاول مجدداً.", "This homework was reissued from a prior attempt. Try again.")}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Ready entry — collapsed: button. Expanded: AudioRecorder which
            handles the optional recording, the upload, and the
            markStudentReady call in one flow. */}
        {showReadyButton && !marked && !recording && (
          <div className="shrink-0">
            {error && <p className="mb-1 text-xs text-error">{error}</p>}
            <button
              onClick={() => { setRecording(true); setError(null); }}
              className="flex items-center gap-2 rounded-full bg-success/10 border border-success/30 px-4 py-2 text-sm font-semibold text-success transition-colors hover:bg-success/20"
            >
              <Mic size={16} aria-hidden="true" />
              {t("أنا جاهز — سجّل تلاوتك", "I'm Ready — record your recitation")}
            </button>
          </div>
        )}

        {/* Marked confirmation */}
        {marked && (
          <div className="flex items-center gap-1 text-sm text-success">
            <CheckCircle size={16} />
            {t("تم! بانتظار المعلم", "Done! Awaiting teacher")}
          </div>
        )}
      </div>

      {/* Expanded recorder — full-width below the meta row when active. */}
      {showReadyButton && !marked && recording && (
        <div className="mt-3">
          <AudioRecorder
            homeworkId={hw.id}
            studentId={studentId}
            onSubmitted={() => { setMarked(true); setRecording(false); }}
            onSkipAudio={handleReadyWithoutAudio}
          />
          {marking && (
            <p className="mt-1 text-xs text-muted">{t("جارٍ التحديث...", "Updating...")}</p>
          )}
        </div>
      )}
    </div>
  );
}
