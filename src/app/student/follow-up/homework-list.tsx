"use client";

import { useState } from "react";
import { BookOpen, CheckCircle, Clock, RefreshCw, Mic, Sparkles, Repeat, Archive } from "lucide-react";
import { markStudentReady } from "@/lib/actions/homework";
import { HOMEWORK_TYPE_AR, HOMEWORK_STATUS_STYLE } from "@/lib/constants";
import { useLang } from "@/lib/i18n/context";
import type { HomeworkAssignment } from "@/types/database";
import { AudioRecorder } from "./audio-recorder";

// Pedagogical buckets for the student dashboard. Order matters — "near"
// goes first because that's the consolidation work the student must do
// before next session; "far" is the spaced-repetition refresh; "new" is
// brand-new material; history is collapsed at the bottom.
type Bucket = "near" | "far" | "new" | "history";

function bucketFor(a: HomeworkAssignment): Bucket {
  if (a.status.startsWith("completed_")) return "history";
  // Older rows pre-migration may have null/undefined; treat as "new".
  const horizon = (a as HomeworkAssignment & { review_horizon?: string | null }).review_horizon;
  if (horizon === "near") return "near";
  if (horizon === "far") return "far";
  return "new";
}

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

  // Bucket each assignment by horizon × status, then within each bucket
  // sort assigned-first (the student's actionable work) followed by
  // student_ready (already turned in, awaiting grading). History
  // (completed_*) goes by completion date, newest first.
  const groups: Record<Bucket, HomeworkAssignment[]> = {
    near: [],
    far: [],
    new: [],
    history: [],
  };
  for (const a of assignments) groups[bucketFor(a)].push(a);

  const sortActive = (arr: HomeworkAssignment[]) =>
    arr.sort((x, y) => {
      const xPri = x.status === "assigned" ? 0 : 1;
      const yPri = y.status === "assigned" ? 0 : 1;
      if (xPri !== yPri) return xPri - yPri;
      return new Date(y.assigned_at).getTime() - new Date(x.assigned_at).getTime();
    });
  sortActive(groups.near);
  sortActive(groups.far);
  sortActive(groups.new);
  groups.history.sort((x, y) => {
    const xt = x.completed_at ? new Date(x.completed_at).getTime() : 0;
    const yt = y.completed_at ? new Date(y.completed_at).getTime() : 0;
    return yt - xt;
  });

  const renderCard = (a: HomeworkAssignment) => (
    <HomeworkCard
      key={a.id}
      hw={a}
      nameMap={nameMap}
      parent={a.parent_assignment_id ? parentMap?.[a.parent_assignment_id] : undefined}
      studentId={studentId}
      t={t}
      showReadyButton={a.status === "assigned"}
    />
  );

  return (
    <div className="space-y-8">
      {groups.near.length > 0 && (
        <Section
          title={t("من جلستك الأخيرة", "From your last session")}
          subtitle={t(
            "ثبّت ما درسته قبل أن يتلاشى — أهم متابعة هذه الفترة",
            "Lock in what you covered before it fades — the most important follow-up right now",
          )}
          icon={<Sparkles size={18} className="text-gold" />}
          count={groups.near.length}
        >
          {groups.near.map(renderCard)}
        </Section>
      )}

      {groups.far.length > 0 && (
        <Section
          title={t("لتثبيت ما درسته سابقاً", "Refresh older lessons")}
          subtitle={t(
            "مراجعة سريعة لدرس قديم لتحافظ عليه طازجاً في ذاكرتك",
            "A quick refresher of an older lesson to keep it fresh in your memory",
          )}
          icon={<Repeat size={18} className="text-blue-400" />}
          count={groups.far.length}
        >
          {groups.far.map(renderCard)}
        </Section>
      )}

      {groups.new.length > 0 && (
        <Section
          title={t("جديد", "New material")}
          subtitle={t(
            "محتوى جديد لم يُربط بمراجعة جلسة معينة",
            "Brand-new material — not tied to reviewing a specific past session",
          )}
          icon={<BookOpen size={18} className="text-success" />}
          count={groups.new.length}
        >
          {groups.new.map(renderCard)}
        </Section>
      )}

      {groups.history.length > 0 && (
        <Section
          title={t("الأرشيف", "History")}
          subtitle={t("متابعات سابقة تم تقييمها", "Past follow-ups already graded")}
          icon={<Archive size={18} className="text-muted" />}
          count={groups.history.length}
        >
          {groups.history.map(renderCard)}
        </Section>
      )}

      {Object.values(groups).every((g) => g.length === 0) && null}
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
  const locale = lang === "ar" ? "ar-EG" : "en-US";
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

          {/* Teacher feedback for graded follow-up */}
          {hw.teacher_notes && (
            <div className="mt-2 rounded-lg border border-gold/20 bg-gold/5 p-2">
              <p className="text-xs text-gold/80">💬 {t("ملاحظات المعلم", "Teacher feedback")}: {hw.teacher_notes}</p>
            </div>
          )}

          {/* Re-attempt context — when this follow-up was auto-regenerated
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
                  {t("أُعيدت هذه المتابعة بناءً على المحاولة السابقة. حاول مجدداً.", "This follow-up was reissued from a prior attempt. Try again.")}
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
