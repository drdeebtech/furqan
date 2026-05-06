"use client";

import { useState, useTransition } from "react";
import { FileText, Headphones, ImageIcon, Link2, Trash2, UserPlus, Video } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import {
  assignResourceToStudentAction,
  deleteTeacherResourceAction,
} from "./actions";

export interface TeacherResourceRow {
  id: string;
  titleAr: string;
  resourceType: "pdf" | "audio" | "link" | "video" | "image";
  fileUrl: string | null;
  externalUrl: string | null;
  createdAt: string;
  assignmentCount: number;
}

export interface RosterStudent {
  id: string;
  fullName: string;
}

const TYPE_ICON: Record<TeacherResourceRow["resourceType"], typeof FileText> = {
  pdf: FileText,
  audio: Headphones,
  link: Link2,
  video: Video,
  image: ImageIcon,
};

function ResourceRow({
  row,
  roster,
}: {
  row: TeacherResourceRow;
  roster: RosterStudent[];
}) {
  const { t } = useLang();
  const [isAssigning, startAssigning] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const [feedback, setFeedback] = useState<
    | { kind: "ok"; message: string }
    | { kind: "err"; message: string }
    | null
  >(null);

  function handleAssign(form: HTMLFormElement) {
    const fd = new FormData(form);
    const studentId = String(fd.get("student_id") ?? "");
    if (!studentId) return;
    setFeedback(null);
    startAssigning(async () => {
      const r = await assignResourceToStudentAction(row.id, studentId);
      if ("success" in r) {
        const name = roster.find((s) => s.id === studentId)?.fullName ?? "";
        setFeedback({
          kind: "ok",
          message: t(`تم الإسناد إلى ${name}`, `Assigned to ${name}`),
        });
        form.reset();
      } else {
        setFeedback({ kind: "err", message: r.error });
      }
    });
  }

  function handleDelete() {
    if (
      !confirm(
        t(
          "حذف هذا المصدر سيلغي جميع إسناداته. متابعة؟",
          "Deleting this resource will revoke all assignments. Continue?",
        ),
      )
    ) {
      return;
    }
    setFeedback(null);
    startDeleting(async () => {
      const r = await deleteTeacherResourceAction(row.id);
      if (!("success" in r)) {
        setFeedback({ kind: "err", message: r.error });
      }
    });
  }

  const Icon = TYPE_ICON[row.resourceType];
  const href = row.fileUrl ?? row.externalUrl ?? "#";

  return (
    <li className="glass-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card text-gold">
            <Icon size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gold focus-ring"
              >
                {row.titleAr}
              </a>
            </p>
            <p className="text-xs text-muted">
              {row.resourceType.toUpperCase()} ·{" "}
              {t(
                `${row.assignmentCount} طالب`,
                `${row.assignmentCount} student${row.assignmentCount === 1 ? "" : "s"}`,
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-error/30 bg-error/5 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-error/15 disabled:opacity-50 focus-ring"
        >
          <Trash2 size={12} aria-hidden="true" />
          {isDeleting ? t("جارٍ الحذف…", "Deleting…") : t("حذف", "Delete")}
        </button>
      </div>

      {feedback && (
        <p
          role={feedback.kind === "err" ? "alert" : "status"}
          className={`mt-2 text-xs ${
            feedback.kind === "ok" ? "text-success" : "text-red-400"
          }`}
        >
          {feedback.message}
        </p>
      )}

      {roster.length > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAssign(e.currentTarget);
          }}
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-card-border pt-3"
        >
          <label className="flex items-center gap-2 text-xs text-muted">
            <UserPlus size={12} aria-hidden="true" />
            {t("أسنده إلى", "Assign to")}
          </label>
          <select
            name="student_id"
            required
            className="glass-input min-w-[180px] px-3 py-1.5 text-sm"
            defaultValue=""
          >
            <option value="" disabled>
              {t("اختر طالباً…", "Select a student…")}
            </option>
            {roster.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isAssigning}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold/20 disabled:opacity-50 focus-ring"
          >
            {isAssigning ? t("جارٍ الإسناد…", "Assigning…") : t("أسنِد", "Assign")}
          </button>
        </form>
      )}
    </li>
  );
}

export function ResourceList({
  rows,
  roster,
}: {
  rows: TeacherResourceRow[];
  roster: RosterStudent[];
}) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <ResourceRow key={r.id} row={r} roster={roster} />
      ))}
    </ul>
  );
}
