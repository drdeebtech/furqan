import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shield, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "سجل المراجعة" };

interface AuditRow {
  id: string; changed_by: string | null; table_name: string; record_id: string;
  action: string; reason: string | null; created_at: string;
}

export default async function ModeratorAuditPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: logs } = await supabase.from("audit_log")
    .select("id, changed_by, table_name, record_id, action, reason, created_at")
    .order("created_at", { ascending: false }).limit(100).returns<AuditRow[]>();
  const list = logs ?? [];

  // Resolve names
  let nameMap: Record<string, string> = {};
  const userIds = [...new Set(list.map(l => l.changed_by).filter(Boolean) as string[])];
  if (userIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
  }

  const actionColor: Record<string, string> = { INSERT: "text-emerald-400", UPDATE: "text-amber-400", DELETE: "text-red-400" };

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Shield size={24} className="text-gold" /> سجل المراجعة</h1>

      {list.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">لا توجد سجلات</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(l => (
            <div key={l.id} className="glass-card rounded-xl p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className={`font-medium ${actionColor[l.action] ?? "text-muted"}`}>{l.action}</span>
                <span className="text-muted">—</span>
                <span className="text-xs text-muted">{l.table_name}</span>
                <span className="text-muted">—</span>
                <span>{l.changed_by ? nameMap[l.changed_by] ?? "—" : "نظام"}</span>
                <span className="mr-auto text-xs text-muted">{new Date(l.created_at).toLocaleString("ar-SA")}</span>
              </div>
              {l.reason && <p className="mt-1 text-xs text-muted">السبب: {l.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
