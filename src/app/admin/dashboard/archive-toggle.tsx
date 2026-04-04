"use client";

import { useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { toggleArchiveTeacher } from "./actions";

export function ArchiveToggle({
  teacherId,
  isArchived,
}: {
  teacherId: string;
  isArchived: boolean;
}) {
  const [archived, setArchived] = useState(isArchived);
  const [loading, setLoading] = useState(false);

  async function handle() {
    setLoading(true);
    const result = await toggleArchiveTeacher(teacherId, !archived);
    if (result.success) {
      setArchived(!archived);
    }
    setLoading(false);
  }

  return (
    <button
      onClick={handle}
      disabled={loading}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        archived
          ? "border-green-500/30 text-green-400 hover:bg-green-500/10"
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
