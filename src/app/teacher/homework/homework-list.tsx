"use client";

import { useState } from "react";
import { Clock, CheckCircle, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { HOMEWORK_TYPE_AR, HOMEWORK_STATUS_STYLE } from "@/lib/constants";
import { useLang } from "@/lib/i18n/context";
import { GradeForm } from "./grade-form";
import type { HomeworkAssignment } from "@/types/database";

export function HomeworkList({
  assignments,
  nameMap,
}: {
  assignments: HomeworkAssignment[];
  nameMap: Record<string, string>;
}) {
  const { t, lang } = useLang();
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  const [gradingId, setGradingId] = useState<string | null>(null);

  // Group assignments
  const ready = assignments.filter(a => a.status === "student_ready");
  const assigned = assignments.filter(a => a.status === "assigned");
  const completed = assignments.filter(a => a.status.startsWith("completed_"));

  return (
    <div className="space-y-8">
      {/* Ready for grading — most important */}
      {ready.length > 0 && (
        <Section
          title={t("جاهز للتسميع", "Ready for grading")}
          icon={<AlertTriangle size={18} className="text-amber-400" />}
          count={ready.length}
        >
          {ready.map(a => (
            <HomeworkCard key={a.id} hw={a} nameMap={nameMap} t={t} locale={locale}>
              {gradingId === a.id ? (
                <GradeForm
                  homeworkId={a.id}
                  homeworkTitle={a.title}
                  onGraded={() => setGradingId(null)}
                />
              ) : (
                <button
                  onClick={() => setGradingId(a.id)}
                  className="glass-gold glass-pill px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-primary-hover focus-ring"
                >
                  {t("تقييم", "Grade")}
                </button>
              )}
            </HomeworkCard>
          ))}
        </Section>
      )}

      {/* Assigned — waiting for student */}
      {assigned.length > 0 && (
        <Section
          title={t("بانتظار الطالب", "Awaiting student")}
          icon={<Clock size={18} className="text-blue-400" />}
          count={assigned.length}
        >
          {assigned.map(a => (
            <HomeworkCard key={a.id} hw={a} nameMap={nameMap} t={t} locale={locale} />
          ))}
        </Section>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <CollapsibleSection
          title={t("مكتملة", "Completed")}
          icon={<CheckCircle size={18} className="text-emerald-400" />}
          count={completed.length}
        >
          {completed.map(a => (
            <HomeworkCard key={a.id} hw={a} nameMap={nameMap} t={t} locale={locale} />
          ))}
        </CollapsibleSection>
      )}
    </div>
  );
}

function Section({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="font-semibold">{title}</h2>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-muted">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function CollapsibleSection({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="mb-3 flex items-center gap-2 text-muted transition-colors hover:text-foreground">
        {icon}
        <h2 className="font-semibold">{title}</h2>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs">{count}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}

function HomeworkCard({
  hw,
  nameMap,
  t,
  locale,
  children,
}: {
  hw: HomeworkAssignment;
  nameMap: Record<string, string>;
  t: (ar: string, en: string) => string;
  locale: string;
  children?: React.ReactNode;
}) {
  const style = HOMEWORK_STATUS_STYLE[hw.status];
  const studentName = nameMap[hw.student_id] ?? t("طالب", "Student");

  return (
    <div className="glass-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs ${style.className}`}>
              {style.label}
            </span>
            <span className="text-sm font-semibold">{hw.title}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <span>{studentName}</span>
            <span>·</span>
            <span>{HOMEWORK_TYPE_AR[hw.homework_type]}</span>
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
          {hw.teacher_notes && (
            <p className="text-xs text-gold/80">💬 {hw.teacher_notes}</p>
          )}
          {hw.parent_assignment_id && (
            <span className="text-xs text-orange-400">↩ {t("واجب مُعاد", "Re-assigned")}</span>
          )}
        </div>
        {children && <div className="shrink-0">{children}</div>}
      </div>
    </div>
  );
}
