import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shield, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "سجل المراجعة" };

interface AuditRow { id: string; changed_by: string | null; table_name: string; record_id: string; action: string; reason: string | null; ip_address: string | null; created_at: string; }

export default async function AdminAuditPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("audit_log").select("id, changed_by, table_name, record_id, action, reason, ip_address, created_at")
    .order("created_at", { ascending: false }).limit(50).returns<AuditRow[]>();
  const logs = data ?? [];

  let nameMap: Record<string, string> = {};
  const changerIds = logs.map(l => l.changed_by).filter(Boolean) as string[];
  if (changerIds.length > 0) {
    const ids = [...new Set(changerIds)];
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
  }

  const actionColor: Record<string, string> = {
    INSERT: "text-emerald-400",
    UPDATE: "text-amber-400",
    DELETE: "text-red-400",
  };

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Shield size={24} className="text-gold" /> {t("سجل المراجعة", "Audit Log")}</h1>
      {logs.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">{t("لا توجد سجلات", "No records")}</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("المستخدم", "User")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الجدول", "Table")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الإجراء", "Action")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("السبب", "Reason")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">IP</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("التاريخ", "Date")}</th>
            </tr></thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} className="border-b border-white/10 last:border-b-0">
                  <td className="px-3 py-3">{l.changed_by ? nameMap[l.changed_by] ?? "—" : t("نظام", "System")}</td>
                  <td className="px-3 py-3 text-xs text-muted" dir="ltr">{l.table_name}</td>
                  <td className="px-3 py-3"><span className={`text-xs font-medium ${actionColor[l.action] ?? "text-muted"}`}>{l.action}</span></td>
                  <td className="px-3 py-3 text-xs text-muted">{l.reason ?? "—"}</td>
                  <td className="px-3 py-3 text-xs text-muted" dir="ltr">{l.ip_address ?? "—"}</td>
                  <td className="px-3 py-3 text-xs text-muted">{new Date(l.created_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
