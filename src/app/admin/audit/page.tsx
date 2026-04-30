import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Shield, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buildNameMap } from "@/lib/admin/name-map";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "سجل المراجعة" };

interface AuditRow { id: string; changed_by: string | null; table_name: string; record_id: string; action: string; reason: string | null; ip_address: string | null; created_at: string; }

type FilterType = "all" | "mutations" | "auth" | "failures";

const FILTER_ACTIONS: Record<FilterType, string[] | null> = {
  all: null,
  mutations: ["INSERT", "UPDATE", "DELETE"],
  auth: ["LOGIN", "LOGOUT"],
  failures: null, // filtered via reason ILIKE below, not by action
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { t, dir, lang } = await getT();
  const sp = await searchParams;
  const filter: FilterType =
    sp.type === "mutations" || sp.type === "auth" || sp.type === "failures" ? sp.type : "all";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let query = supabase.from("audit_log")
    .select("id, changed_by, table_name, record_id, action, reason, ip_address, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const allowed = FILTER_ACTIONS[filter];
  if (allowed) query = query.in("action", allowed);
  if (filter === "failures") query = query.ilike("reason", "%FAILED%");

  const { data } = await query.returns<AuditRow[]>();
  const logs = data ?? [];

  const nameMap = await buildNameMap(
    supabase,
    [...new Set(logs.map(l => l.changed_by).filter(Boolean) as string[])],
  );

  const actionColor: Record<string, string> = {
    INSERT: "text-success",
    UPDATE: "text-warning",
    DELETE: "text-red-400",
    LOGIN: "text-gold",
    LOGOUT: "text-slate-400",
  };

  const filterTabs: { value: FilterType; label: string }[] = [
    { value: "all", label: t("الكل", "All") },
    { value: "mutations", label: t("التغييرات", "Mutations") },
    { value: "auth", label: t("الدخول والخروج", "Auth events") },
    { value: "failures", label: t("الإجراءات الفاشلة", "Failures") },
  ];

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Shield size={24} className="text-gold" /> {t("سجل المراجعة", "Audit Log")}
        </h1>
        <div className="flex items-center gap-1 rounded-xl border border-[var(--surface-border)] bg-surface p-1 text-xs">
          {filterTabs.map((tab) => (
            <Link
              key={tab.value}
              href={tab.value === "all" ? "/admin/audit" : `/admin/audit?type=${tab.value}`}
              aria-current={filter === tab.value ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 transition-colors ${
                filter === tab.value
                  ? "bg-gold/20 text-gold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" aria-hidden="true" /><p className="text-muted">{t("لا توجد سجلات", "No records")}</p></div>
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
                  <td className="px-3 py-3 text-xs text-muted">{new Date(l.created_at).toLocaleString(lang === "ar" ? "ar" : "en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
