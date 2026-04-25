"use client";

import { useState, useTransition } from "react";
import { Trash2, RotateCcw, AlertTriangle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { softDeleteUser, restoreUser } from "../actions";

interface DeleteControlsProps {
  userId: string;
  userName: string;
  isDeleted: boolean;
  isSelf: boolean;
}

export function DeleteControls({ userId, userName, isDeleted, isSelf }: DeleteControlsProps) {
  const { t } = useLang();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Self-protection: never let admin delete their own account from the UI.
  if (isSelf) return null;

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const r = await softDeleteUser(userId, reason);
      if (r.error) setError(r.error);
      else {
        setConfirming(false);
        setReason("");
      }
    });
  }

  function handleRestore() {
    setError(null);
    startTransition(async () => {
      const r = await restoreUser(userId);
      if (r.error) setError(r.error);
    });
  }

  if (isDeleted) {
    return (
      <div className="flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={handleRestore}
          disabled={pending}
          aria-busy={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
        >
          <RotateCcw size={12} aria-hidden="true" />
          {pending ? t("جاري الاستعادة…", "Restoring…") : t("استعادة المستخدم", "Restore User")}
        </button>
        {error && (
          <span role="alert" className="text-xs text-red-400">{error}</span>
        )}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertTriangle size={12} aria-hidden="true" />
          {t(`هل أنت متأكد من حذف ${userName}؟`, `Delete ${userName}?`)}
        </div>
        <p className="text-[11px] text-muted">
          {t(
            "حذف ناعم — سيتم تعطيل الحساب وحفظ السجل. يمكن الاستعادة لاحقاً.",
            "Soft delete — account disabled and history preserved. Reversible.",
          )}
        </p>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("سبب الحذف (مطلوب)", "Reason (required)")}
          className="w-64 rounded-lg border border-red-500/20 bg-surface px-2 py-1 text-xs"
          maxLength={200}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending || reason.trim().length < 3}
            aria-busy={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
          >
            <Trash2 size={12} aria-hidden="true" />
            {pending ? t("جاري الحذف…", "Deleting…") : t("نعم، احذف", "Yes, delete")}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setReason("");
              setError(null);
            }}
            disabled={pending}
            className="rounded-lg border border-surface-border/60 px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            {t("إلغاء", "Cancel")}
          </button>
        </div>
        {error && (
          <span role="alert" className="text-xs text-red-400">{error}</span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
    >
      <Trash2 size={12} aria-hidden="true" />
      {t("حذف المستخدم", "Delete User")}
    </button>
  );
}
