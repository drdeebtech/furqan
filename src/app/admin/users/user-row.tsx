"use client";
import { useState } from "react";
import { toggleUserActive, changeUserRole } from "./actions";

interface Props {
  user: { id: string; role: string; full_name: string | null; country: string | null; is_active: boolean; created_at: string };
}

export function UserRow({ user }: Props) {
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
    <tr className="border-b border-card-border last:border-b-0">
      <td className="px-4 py-3 font-medium">{user.full_name ?? "—"}</td>
      <td className="px-4 py-3">
        {pendingRole ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-amber-400">تأكيد التغيير؟</p>
            <div className="flex gap-2">
              <button
                onClick={confirmRoleChange}
                disabled={roleLoading}
                className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
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
            className="rounded border border-card-border bg-surface px-2 py-1 text-xs text-foreground"
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
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${active ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`}
        >
          {active ? "نشط" : "معطل"}
        </button>
      </td>
      <td className="px-4 py-3 text-xs text-muted">{new Date(user.created_at).toLocaleDateString("ar-SA")}</td>
    </tr>
  );
}
