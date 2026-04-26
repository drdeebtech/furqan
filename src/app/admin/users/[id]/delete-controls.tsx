"use client";

import { useState, useTransition } from "react";
import { Trash2, RotateCcw, AlertTriangle, FlameKindling } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { softDeleteUser, restoreUser, hardDeleteUser } from "../actions";

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

  // Hard-delete state lives separately so it doesn't interfere with the
  // soft-delete confirm flow.
  const [hardConfirming, setHardConfirming] = useState(false);
  const [hardNameInput, setHardNameInput] = useState("");

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

  function handleHardDelete() {
    setError(null);
    startTransition(async () => {
      const r = await hardDeleteUser(userId, hardNameInput);
      if (r.error) {
        setError(r.error);
      } else {
        // After hard-delete, the user no longer exists; redirect via revalidate.
        // Resetting state so the UI doesn't briefly show a stale form.
        setHardConfirming(false);
        setHardNameInput("");
      }
    });
  }

  if (isDeleted) {
    return (
      <div className="flex flex-col items-end gap-3">
        {/* Restore — the safer path, listed first */}
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

        {/* Hard-delete — only available on already-archived users.
            Two-step inside its own panel: button → typed-name confirmation. */}
        {hardConfirming ? (
          <div className="flex flex-col items-end gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-red-300">
              <FlameKindling size={14} aria-hidden="true" />
              {t("حذف نهائي — لا يمكن التراجع", "Permanent delete — cannot be undone")}
            </div>
            <p className="max-w-[18rem] text-[11px] leading-relaxed text-muted">
              {t(
                `سيُمحى المستخدم وكل بياناته من قاعدة البيانات. اكتب اسمه بالضبط للتأكيد:`,
                `The user and all related data will be erased from the database. Type the user's exact name to confirm:`,
              )}
            </p>
            <code className="rounded bg-surface px-2 py-0.5 text-[11px] text-foreground">{userName}</code>
            <input
              type="text"
              value={hardNameInput}
              onChange={(e) => setHardNameInput(e.target.value)}
              placeholder={t("اكتب الاسم بالضبط", "Type the exact name")}
              className="w-64 rounded-lg border border-red-500/30 bg-surface px-2 py-1 text-xs"
              autoComplete="off"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleHardDelete}
                disabled={pending || hardNameInput.trim() !== userName.trim()}
                aria-busy={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-40"
              >
                <FlameKindling size={12} aria-hidden="true" />
                {pending ? t("جاري الحذف النهائي…", "Erasing…") : t("احذف نهائياً", "Erase permanently")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setHardConfirming(false);
                  setHardNameInput("");
                  setError(null);
                }}
                disabled={pending}
                className="rounded-lg border border-surface-border/60 px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
              >
                {t("إلغاء", "Cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setHardConfirming(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/15"
            title={t("حذف من قاعدة البيانات نهائياً", "Erase from database permanently")}
          >
            <FlameKindling size={12} aria-hidden="true" />
            {t("حذف نهائي…", "Delete permanently…")}
          </button>
        )}

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
