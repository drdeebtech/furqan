"use client";

import { useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { toggleArchiveTeacher } from "./actions";

/**
 * Renders a control for archiving or restoring a teacher.
 *
 * Shows a single button for restore or archive; when initiating an archive it first shows an inline
 * destructive confirmation with "Yes, archive" and "Cancel" actions. While an operation is in
 * progress the control disables interactions and displays a spinner.
 *
 * @param teacherId - The identifier of the teacher to archive or restore
 * @param isArchived - Initial archived state used to initialize the component's local state
 * @returns The JSX element for the archive/restore toggle or the inline confirmation UI
 */
export function ArchiveToggle({
  teacherId,
  isArchived,
}: {
  teacherId: string;
  isArchived: boolean;
}) {
  const [archived, setArchived] = useState(isArchived);
  const [loading, setLoading] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function handle() {
    setLoading(true);
    const result = await toggleArchiveTeacher(teacherId, !archived);
    if (result.success) {
      setArchived(!archived);
    }
    setLoading(false);
    setConfirmArchive(false);
  }

  // Inline confirmation for archiving (destructive)
  if (!archived && confirmArchive) {
    return (
      <div className="flex flex-col items-end gap-2">
        <p className="text-xs text-error">هل أنت متأكد من أرشفة هذا المعلم؟</p>
        <div className="flex gap-2">
          <button
            onClick={handle}
            disabled={loading}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              "نعم، أرشف"
            )}
          </button>
          <button
            onClick={() => setConfirmArchive(false)}
            disabled={loading}
            className="rounded-lg border border-card-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={archived ? handle : () => setConfirmArchive(true)}
      disabled={loading}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        archived
          ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
          : "border-red-500/30 text-red-400 hover:bg-red-500/10"
      }`}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
      ) : archived ? (
        <ArchiveRestore size={14} />
      ) : (
        <Archive size={14} />
      )}
      {archived ? "إلغاء الأرشفة" : "أرشفة"}
    </button>
  );
}
