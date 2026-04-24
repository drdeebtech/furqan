import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Activity, CheckCircle, XCircle, Clock, SkipForward } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { AutomationLog } from "@/types/database";

export const metadata: Metadata = { title: "الأتمتة" };

const STATUS_ICON: Record<string, { icon: typeof CheckCircle; color: string }> = {
  succeeded: { icon: CheckCircle, color: "text-emerald-400" },
  failed: { icon: XCircle, color: "text-red-400" },
  started: { icon: Clock, color: "text-amber-400" },
  skipped: { icon: SkipForward, color: "text-muted" },
};

export default async function AdminAutomationPage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-SA" : "en-US";
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
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Activity size={24} className="text-gold" />
        <h1 className="text-xl font-bold">{t("مركز الأتمتة", "Automation Center")}</h1>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="glass-card p-5 text-center">
          <p className="font-display text-2xl font-bold text-gold">{total}</p>
          <p className="text-xs text-muted">{t("إجمالي العمليات", "Total Operations")}</p>
        </div>
        <div className="glass-card p-5 text-center">
          <p className="font-display text-2xl font-bold text-emerald-400">{succeeded}</p>
          <p className="text-xs text-muted">{t("ناجحة", "Succeeded")}</p>
        </div>
        <div className="glass-card p-5 text-center">
          <p className="font-display text-2xl font-bold text-red-400">{failed}</p>
          <p className="text-xs text-muted">{t("فاشلة", "Failed")}</p>
        </div>
      </div>

      {/* Feature Flags */}
      <div className="mb-6 glass-card p-5">
        <h2 className="mb-3 font-semibold">{t("أعلام التحكم", "Feature Flags")}</h2>
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
        <p className="mt-2 text-xs text-muted">{t("يمكن تعديلها من صفحة الإعدادات", "Editable from Settings page")}</p>
      </div>

      {/* Recent Logs */}
      <div className="glass-card p-5">
        <h2 className="mb-3 font-semibold">{t("آخر العمليات", "Recent Operations")}</h2>
        {allLogs.length === 0 ? (
          <div className="py-8 text-center text-muted">
            <Activity size={32} className="mx-auto mb-2 text-muted/30" />
            <p>{t("لا توجد عمليات أتمتة بعد", "No automation operations yet")}</p>
            <p className="mt-1 text-xs">{t("ستظهر هنا بعد تفعيل workflows في n8n", "They'll appear here once n8n workflows run")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--surface-border)] text-xs text-muted">
                  <th className="pb-2 text-start font-medium">{t("الحالة", "Status")}</th>
                  <th className="pb-2 text-start font-medium">Workflow</th>
                  <th className="pb-2 text-start font-medium">Event</th>
                  <th className="pb-2 text-start font-medium">{t("القناة", "Channel")}</th>
                  <th className="pb-2 text-start font-medium">{t("التوقيت", "Time")}</th>
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
                        {new Date(log.started_at).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
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
