"use client";
import { useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import { toggleUserActive, setUserRoles, softDeleteUser, restoreUser } from "./actions";
import { riskBadgeClass, riskLabel } from "@/lib/retention/ui";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";

type Role = "student" | "teacher" | "admin";
const ALL_ROLES: ReadonlyArray<Role> = ["student", "teacher", "admin"];

const ROLE_LABEL_AR: Record<Role, string> = {
  student: "طالب",
  teacher: "معلم",
  admin: "مدير",
};
const ROLE_LABEL_EN: Record<Role, string> = {
  student: "Student",
  teacher: "Teacher",
  admin: "Admin",
};

interface Props {
  user: { id: string; role: string; roles: string[] | null; full_name: string | null; country: string | null; is_active: boolean; deleted_at: string | null; created_at: string };
  churnRisk?: number | null;
  currentAdminId: string;
}

export function UserRow({ user, churnRisk, currentAdminId }: Props) {
  const { t, lang } = useLang();
  const toast = useToast();
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const [active, setActive] = useState(user.is_active);
  // Initial set: prefer the new roles[] column, fall back to single role for
  // any row that slipped through the backfill.
  const initialRoles = (user.roles ?? [user.role]) as Role[];
  const [roles, setRoles] = useState<Role[]>(initialRoles);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Role[]>(initialRoles);
  const [savingRoles, setSavingRoles] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const [deleted, setDeleted] = useState<boolean>(!!user.deleted_at);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTx] = useTransition();
  const isSelf = user.id === currentAdminId;
  const labelFor = (r: Role) => (lang === "ar" ? ROLE_LABEL_AR[r] : ROLE_LABEL_EN[r]);

  // Close the editor on outside click so the popover doesn't linger.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (editRef.current && !editRef.current.contains(e.target as Node)) {
        setEditing(false);
        setRolesError(null);
      }
    }
    if (editing) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [editing]);

  function toggleDraftRole(r: Role) {
    setDraft((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  async function saveRoles() {
    if (draft.length === 0) {
      setRolesError(t("يجب اختيار دور واحد على الأقل", "Select at least one role"));
      return;
    }
    setSavingRoles(true);
    setRolesError(null);
    const res = await setUserRoles(user.id, draft);
    setSavingRoles(false);
    if (res?.error) {
      setRolesError(res.error);
      return;
    }
    setRoles(draft);
    setEditing(false);
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
        <div ref={editRef} className="relative inline-block">
          <button
            type="button"
            onClick={() => { setDraft(roles); setEditing((v) => !v); }}
            aria-haspopup="dialog"
            aria-expanded={editing}
            className="flex flex-wrap items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors hover:bg-foreground/5"
            title={t("اضغط لتعديل الأدوار", "Click to edit roles")}
          >
            {roles.length === 0 ? (
              <span className="text-muted">—</span>
            ) : (
              roles.map((r) => (
                <span key={r} className="glass-badge border-gold/30 bg-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-gold">
                  {labelFor(r)}
                </span>
              ))
            )}
          </button>
          {editing && (
            <div
              role="dialog"
              aria-label={t("تعديل الأدوار", "Edit roles")}
              className="absolute start-0 top-full z-50 mt-1 w-48 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-3 shadow-lg"
            >
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                {t("الأدوار", "Roles")}
              </p>
              <div className="space-y-1.5">
                {ALL_ROLES.map((r) => (
                  <label key={r} className="flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={draft.includes(r)}
                      onChange={() => toggleDraftRole(r)}
                      disabled={savingRoles}
                      className="h-3.5 w-3.5 accent-gold"
                    />
                    <span>{labelFor(r)}</span>
                  </label>
                ))}
              </div>
              {rolesError && (
                <p role="alert" className="mt-2 text-[10px] text-red-400">{rolesError}</p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setEditing(false); setRolesError(null); }}
                  disabled={savingRoles}
                  className="text-xs text-muted transition-colors hover:text-foreground"
                >
                  {t("إلغاء", "Cancel")}
                </button>
                <button
                  type="button"
                  onClick={saveRoles}
                  disabled={savingRoles}
                  className="glass-gold rounded px-2 py-0.5 text-xs font-medium text-white transition-colors disabled:opacity-50"
                >
                  {savingRoles ? "…" : t("حفظ", "Save")}
                </button>
              </div>
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-muted">{user.country ?? "—"}</td>
      <td className="px-4 py-3">
        <button
          onClick={async () => {
            const next = !active;
            setActive(next);
            const res = await toggleUserActive(user.id, next);
            if (res?.error) {
              setActive(!next);
              toast.error(res.error);
            }
          }}
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
