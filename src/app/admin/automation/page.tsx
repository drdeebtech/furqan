import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Activity, CheckCircle, XCircle, Clock, SkipForward } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { AutomationLog } from "@/types/database";

export const metadata: Metadata = { title: "الأتمتة" };

const STATUS_ICON: Record<string, { icon: typeof CheckCircle; color: string }> = {
  succeeded: { icon: CheckCircle, color: "text-emerald-400" },
  failed: { icon: XCircle, color: "text-red-400" },
  started: { icon: Clock, color: "text-amber-400" },
  skipped: { icon: SkipForward, color: "text-muted" },
};

export default async function AdminAutomationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") redirect("/login");

  // Recent logs
  const { data: logs } = await supabase
    .from("automation_logs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(50)
    .returns<AutomationLog[]>();

  // Stats
  const allLogs = logs ?? [];
  const succeeded = allLogs.filter(l => l.status === "succeeded").length;
  const failed = allLogs.filter(l => l.status === "failed").length;
  const total = allLogs.length;

  // Feature flags
  const { data: flags } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", ["automation_enabled", "whatsapp_enabled", "ai_parent_reports_enabled", "teacher_quality_monitor_enabled", "retention_automation_enabled", "renewal_campaigns_enabled"])
    .returns<{ key: string; value: string }[]>();

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Activity size={24} className="text-gold" />
        <h1 className="text-xl font-bold">مركز الأتمتة</h1>
        <span className="text-sm text-muted">Automation Hub</span>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="glass-card p-5 text-center">
          <p className="font-display text-2xl font-bold text-gold">{total}</p>
          <p className="text-xs text-muted">إجمالي العمليات</p>
        </div>
        <div className="glass-card p-5 text-center">
          <p className="font-display text-2xl font-bold text-emerald-400">{succeeded}</p>
          <p className="text-xs text-muted">ناجحة</p>
        </div>
        <div className="glass-card p-5 text-center">
          <p className="font-display text-2xl font-bold text-red-400">{failed}</p>
          <p className="text-xs text-muted">فاشلة</p>
        </div>
      </div>

      {/* Feature Flags */}
      <div className="mb-6 glass-card p-5">
        <h2 className="mb-3 font-semibold">أعلام التحكم <span className="text-xs text-muted">Feature Flags</span></h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {(flags ?? []).map(f => (
            <div key={f.key} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
              <span className="text-sm">{f.key.replace(/_/g, " ")}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${f.value === "true" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                {f.value === "true" ? "ON" : "OFF"}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">يمكن تعديلها من صفحة الإعدادات</p>
      </div>

      {/* Recent Logs */}
      <div className="glass-card p-5">
        <h2 className="mb-3 font-semibold">آخر العمليات <span className="text-xs text-muted">Recent Logs</span></h2>
        {allLogs.length === 0 ? (
          <div className="py-8 text-center text-muted">
            <Activity size={32} className="mx-auto mb-2 text-muted/30" />
            <p>لا توجد عمليات أتمتة بعد</p>
            <p className="mt-1 text-xs">ستظهر هنا بعد تفعيل workflows في n8n</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--surface-border)] text-xs text-muted">
                  <th className="pb-2 text-start font-medium">الحالة</th>
                  <th className="pb-2 text-start font-medium">Workflow</th>
                  <th className="pb-2 text-start font-medium">Event</th>
                  <th className="pb-2 text-start font-medium">القناة</th>
                  <th className="pb-2 text-start font-medium">التوقيت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--surface-divider)]">
                {allLogs.map(log => {
                  const s = STATUS_ICON[log.status] ?? STATUS_ICON.started;
                  const Icon = s.icon;
                  return (
                    <tr key={log.id}>
                      <td className="py-2">
                        <Icon size={14} className={s.color} />
                      </td>
                      <td className="py-2 font-medium">{log.workflow_name}</td>
                      <td className="py-2 text-muted">{log.event_name ?? "—"}</td>
                      <td className="py-2 text-muted">{log.channel ?? "—"}</td>
                      <td className="py-2 text-xs text-muted">
                        {new Date(log.started_at).toLocaleString("ar-SA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
