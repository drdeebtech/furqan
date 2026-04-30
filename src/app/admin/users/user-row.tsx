"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { toggleUserActive, changeUserRole, softDeleteUser, restoreUser } from "./actions";
import { riskBadgeClass, riskLabel } from "@/lib/retention/ui";
import { useLang } from "@/lib/i18n/context";

interface Props {
  user: { id: string; role: string; full_name: string | null; country: string | null; is_active: boolean; deleted_at: string | null; created_at: string };
  churnRisk?: number | null;
  currentAdminId: string;
}

export function UserRow({ user, churnRisk, currentAdminId }: Props) {
  const { t, lang } = useLang();
  const locale = lang === "ar" ? "ar" : "en-US";
  const [active, setActive] = useState(user.is_active);
  const [role, setRole] = useState(user.role);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [deleted, setDeleted] = useState<boolean>(!!user.deleted_at);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTx] = useTransition();
  const isSelf = user.id === currentAdminId;

  async function confirmRoleChange() {
    if (!pendingRole) return;
    setRoleLoading(true);
    setRole(pendingRole);
    await changeUserRole(user.id, pendingRole);
    setRoleLoading(false);
    setPendingRole(null);
  }

  function handleDelete() {
    if (!deleteReason.trim()) {
      setDeleteError(t("سبب الحذف مطلوب", "Reason is required"));
      return;
    }
    setDeleteError(null);
    startDeleteTx(async () => {
      const res = await softDeleteUser(user.id, deleteReason.trim());
      if (res?.error) {
        setDeleteError(res.error);
        return;
      }
      setDeleted(true);
      setActive(false);
      setShowDeleteConfirm(false);
      setDeleteReason("");
    });
  }

  function handleRestore() {
    startDeleteTx(async () => {
      const res = await restoreUser(user.id);
      if (res?.error) {
        setDeleteError(res.error);
        return;
      }
      setDeleted(false);
      setActive(true);
    });
  }

  return (
    <tr className={`border-b border-white/10 last:border-b-0 ${deleted ? "opacity-50" : ""}`}>
      <td className="px-4 py-3 font-medium">
        <Link href={`/admin/users/${user.id}`} className="hover:text-gold">
          {user.full_name ?? "—"}
          {deleted && (
            <span className="ms-2 inline-flex items-center rounded-full border border-error/30 bg-error/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-red-400">
              {lang === "ar" ? "محذوف" : "deleted"}
            </span>
          )}
        </Link>
      </td>
      <td className="px-4 py-3">
        {pendingRole ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-warning">تأكيد التغيير؟</p>
            <div className="flex gap-2">
              <button
                onClick={confirmRoleChange}
                disabled={roleLoading}
                className="glass-danger glass-pill px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {roleLoading ? "..." : "تأكيد"}
              </button>
              <button
                onClick={() => setPendingRole(null)}
                disabled={roleLoading}
                className="text-xs text-muted transition-colors hover:text-foreground"
              >
                إلغاء
              </button>
            </div>
          </div>
        ) : (
          <select
            value={role}
            onChange={(e) => {
              if (e.target.value !== role) {
                setPendingRole(e.target.value);
              }
            }}
            className="glass-input rounded px-2 py-1 text-xs text-foreground"
          >
            <option value="student">طالب</option>
            <option value="teacher">معلم</option>
            <option value="moderator">مشرف</option>
            <option value="admin">مدير</option>
          </select>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted">{user.country ?? "—"}</td>
      <td className="px-4 py-3">
        <button
          onClick={async () => { setActive(!active); await toggleUserActive(user.id, !active); }}
          className={`glass-badge ${active ? "bg-success/10 text-success border-success/30" : "bg-error/10 text-red-400 border-error/30"}`}
        >
          {active ? "نشط" : "معطل"}
        </button>
      </td>
      <td className="px-4 py-3 text-xs">
        {user.role === "student" ? (
          churnRisk != null ? (
            <span className={`glass-badge ${riskBadgeClass(churnRisk)}`} title={`${churnRisk.toFixed(0)} / 100`}>
              {riskLabel(churnRisk)}
            </span>
          ) : (
            <span className="text-muted">—</span>
          )
        ) : null}
      </td>
      <td className="px-4 py-3 text-xs text-muted">{new Date(user.created_at).toLocaleDateString(locale)}</td>
      <td className="px-4 py-3 text-end">
        {isSelf ? (
          <span className="text-[10px] text-muted">{t("(أنت)", "(you)")}</span>
        ) : deleted ? (
          <button
            onClick={handleRestore}
            disabled={isDeleting}
            className="glass-pill px-2 py-1 text-xs text-success transition-colors hover:bg-success/10 disabled:opacity-50"
          >
            {isDeleting ? "..." : t("استعادة", "Restore")}
          </button>
        ) : showDeleteConfirm ? (
          <div className="flex flex-col items-end gap-1">
            <input
              type="text"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder={t("سبب الحذف", "Reason")}
              autoFocus
              className="glass-input w-32 rounded px-2 py-1 text-xs"
            />
            <div className="flex gap-1">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="glass-pill px-2 py-0.5 text-xs text-red-400 transition-colors hover:bg-error/10 disabled:opacity-50"
              >
                {isDeleting ? "..." : t("تأكيد", "Confirm")}
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteReason(""); setDeleteError(null); }}
                disabled={isDeleting}
                className="text-xs text-muted transition-colors hover:text-foreground"
              >
                {t("إلغاء", "Cancel")}
              </button>
            </div>
            {deleteError && (
              <p role="alert" className="text-[10px] text-red-400">{deleteError}</p>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="glass-pill px-2 py-1 text-xs text-muted transition-colors hover:bg-error/10 hover:text-red-400"
          >
            {t("حذف", "Delete")}
          </button>
        )}
      </td>
    </tr>
  );
}
