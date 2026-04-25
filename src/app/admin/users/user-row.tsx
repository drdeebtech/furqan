"use client";
import { useState } from "react";
import Link from "next/link";
import { toggleUserActive, changeUserRole } from "./actions";
import { riskBadgeClass, riskLabel } from "@/lib/retention/ui";
import { useLang } from "@/lib/i18n/context";

interface Props {
  user: { id: string; role: string; full_name: string | null; country: string | null; is_active: boolean; deleted_at: string | null; created_at: string };
  churnRisk?: number | null;
}

export function UserRow({ user, churnRisk }: Props) {
  const { lang } = useLang();
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  const [active, setActive] = useState(user.is_active);
  const [role, setRole] = useState(user.role);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);

  async function confirmRoleChange() {
    if (!pendingRole) return;
    setRoleLoading(true);
    setRole(pendingRole);
    await changeUserRole(user.id, pendingRole);
    setRoleLoading(false);
    setPendingRole(null);
  }

  return (
    <tr className={`border-b border-white/10 last:border-b-0 ${user.deleted_at ? "opacity-50" : ""}`}>
      <td className="px-4 py-3 font-medium">
        <Link href={`/admin/users/${user.id}`} className="hover:text-gold">
          {user.full_name ?? "—"}
          {user.deleted_at && (
            <span className="ms-2 inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-red-400">
              {lang === "ar" ? "محذوف" : "deleted"}
            </span>
          )}
        </Link>
      </td>
      <td className="px-4 py-3">
        {pendingRole ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-amber-400">تأكيد التغيير؟</p>
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
          className={`glass-badge ${active ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-red-500/10 text-red-400 border-red-500/30"}`}
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
    </tr>
  );
}
