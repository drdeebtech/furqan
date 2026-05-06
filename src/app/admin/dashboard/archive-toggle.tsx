"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toggleArchiveTeacher } from "./actions";

type GateHint =
  | { kind: "ok" }
  | { kind: "cv-not-approved" }
  | { kind: "not-accepting" }
  | null;

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
  const [gateHint, setGateHint] = useState<GateHint>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, []);

  async function handle() {
    setLoading(true);
    setGateHint(null);
    const wasArchived = archived;
    const result = await toggleArchiveTeacher(teacherId, !archived);

    if (result.success) {
      const nowArchived = !archived;
      setArchived(nowArchived);

      // After a successful UNARCHIVE, check whether the teacher actually
      // becomes publicly visible. The public /teachers filters on
      // three gates: !is_archived AND is_accepting AND cv_status='approved'.
      // We just cleared the first one — surface the other two so the
      // admin doesn't expect them on the public page only to find them
      // still hidden behind cv-pending or accepting=false.
      if (wasArchived && !nowArchived) {
        if (result.cvStatus !== "approved") {
          setGateHint({ kind: "cv-not-approved" });
        } else if (result.isAccepting === false) {
          setGateHint({ kind: "not-accepting" });
        } else {
          setGateHint({ kind: "ok" });
          // Auto-dismiss the success hint after 4s; the persistent
          // "still gated" hints stay until the admin acts on them.
          // Tracked via ref so unmount-during-the-4s clears it.
          if (dismissTimerRef.current !== null) clearTimeout(dismissTimerRef.current);
          dismissTimerRef.current = setTimeout(() => setGateHint(null), 4000);
        }
      }
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
            className="glass-danger glass-pill px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
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
            className="glass glass-pill px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        onClick={archived ? handle : () => setConfirmArchive(true)}
        disabled={loading}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
          archived
            ? "border-success/30 text-success hover:bg-success/10"
            : "border-error/30 text-red-400 hover:bg-error/10"
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

      {/* Gate-state hint: shown after a successful unarchive.
          Tells the admin whether the teacher is now publicly visible
          or still blocked by another gate (CV not approved / not accepting). */}
      {gateHint?.kind === "cv-not-approved" && (
        <p className="flex max-w-[18rem] items-start gap-1 text-end text-[11px] leading-snug text-warning">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            تم إلغاء الأرشفة — لن يظهر علناً حتى{" "}
            <Link href={`/admin/teachers/cv/${teacherId}`} className="underline hover:text-warning">
              اعتماد السيرة الذاتية
            </Link>
          </span>
        </p>
      )}
      {gateHint?.kind === "not-accepting" && (
        <p className="flex max-w-[18rem] items-start gap-1 text-end text-[11px] leading-snug text-warning">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            تم إلغاء الأرشفة — لن يظهر علناً حتى تفعيل{" "}
            <Link href={`/admin/teachers/${teacherId}`} className="underline hover:text-warning">
              «يقبل طلاب»
            </Link>
          </span>
        </p>
      )}
      {gateHint?.kind === "ok" && (
        <p className="flex items-center gap-1 text-[11px] text-success">
          <CheckCircle2 size={11} aria-hidden="true" />
          تم — يظهر الآن للزوار
        </p>
      )}
    </div>
  );
}
