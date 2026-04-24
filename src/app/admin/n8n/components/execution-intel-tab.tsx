"use client";

import { useState, useEffect, startTransition, useMemo } from "react";
import {
  RefreshCw,
  Activity,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Flame,
  Eye,
  AlertTriangle,
} from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { AnalyticsChart } from "@/components/shared/analytics-chart";
import { BreakdownBar } from "@/components/shared/breakdown-bar";
import { ExecutionDetailModal } from "./execution-detail-modal";

interface Execution {
  id: string;
  workflowId: string;
  status: string;
  startedAt: string;
  stoppedAt: string | null;
}

interface ErrorExecution extends Execution {
  data?: { resultData?: { error?: { message: string } } };
}

const BREAKDOWN_COLORS = [
  "#EF4444", "#F59E0B", "#8B5CF6", "#3B82F6", "#EC4899",
  "#10B981", "#F97316", "#06B6D4", "#6366F1", "#14B8A6",
];

export function ExecutionIntelTab() {
  const { t, lang } = useLang();
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  const [allExecs, setAllExecs] = useState<Execution[]>([]);
  const [errorExecs, setErrorExecs] = useState<ErrorExecution[]>([]);
  const [workflowNameMap, setWorkflowNameMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExecId, setSelectedExecId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const [allRes, errorRes, wfRes] = await Promise.all([
          fetch("/api/n8n/executions/all").then((r) => r.json()),
          fetch("/api/n8n/executions").then((r) => r.json()),
          fetch("/api/n8n/workflows").then((r) => r.json()),
        ]);
        if (!cancelled) {
          startTransition(() => {
            if (allRes.data) setAllExecs(allRes.data);
            if (errorRes.data) setErrorExecs(errorRes.data);
            if (wfRes.data) {
              const nameMap = new Map<string, string>();
              for (const wf of wfRes.data as { id: string; name: string }[]) {
                nameMap.set(wf.id, wf.name);
              }
              setWorkflowNameMap(nameMap);
            }
            setLoading(false);
          });
        }
      } catch (err) {
        if (!cancelled) {
          startTransition(() => {
            setError(String(err));
            setLoading(false);
          });
        }
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  // Stats
  const totalCount = allExecs.length;
  const successCount = allExecs.filter((e) => e.status === "success").length;
  const failedCount = allExecs.filter((e) => e.status === "error").length;
  const successRate = totalCount > 0 ? ((successCount / totalCount) * 100).toFixed(1) : "0";

  // Chart data: last 7 days
  const chartData = useMemo(() => {
    const days: { day: string; value: number; isActive: boolean }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString(locale, { weekday: "short" });
      const count = allExecs.filter(
        (e) => e.startedAt.slice(0, 10) === key,
      ).length;
      days.push({ day: dayLabel, value: count, isActive: count > 0 });
    }
    return days;
  }, [allExecs]);

  // Failure breakdown by workflow
  const failureSegments = useMemo(() => {
    const byWf = new Map<string, number>();
    for (const ex of allExecs) {
      if (ex.status !== "error") continue;
      byWf.set(ex.workflowId, (byWf.get(ex.workflowId) || 0) + 1);
    }
    return Array.from(byWf.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([wfId, count], i) => ({
        label: workflowNameMap.get(wfId) || wfId,
        value: count,
        color: BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length],
      }));
  }, [allExecs, workflowNameMap]);

  // Recurring failure alerts: workflows with 3+ failures in last hour
  const recurringAlerts = useMemo(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recent = allExecs.filter(
      (e) => e.status === "error" && new Date(e.startedAt).getTime() > oneHourAgo,
    );
    const byWf = new Map<string, Execution[]>();
    for (const ex of recent) {
      const list = byWf.get(ex.workflowId) || [];
      list.push(ex);
      byWf.set(ex.workflowId, list);
    }
    const alerts: { workflowId: string; count: number; latest: string }[] = [];
    for (const [wfId, execs] of byWf) {
      if (execs.length >= 3) {
        alerts.push({
          workflowId: wfId,
          count: execs.length,
          latest: execs.sort(
            (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
          )[0].startedAt,
        });
      }
    }
    return alerts.sort((a, b) => b.count - a.count);
  }, [allExecs]);

  // Recent 20 failed executions
  const recentFailed = useMemo(() => {
    return allExecs
      .filter((e) => e.status === "error")
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 20);
  }, [allExecs]);

  if (loading) {
    return (
      <div className="glass-card p-12 text-center text-muted">
        <RefreshCw size={28} className="mx-auto mb-3 animate-spin text-gold" />
        <p className="text-sm">{t("جاري تحميل بيانات التنفيذ...", "Loading execution data...")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section A: Stats Row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="glass-card p-4 text-center">
          <Activity size={18} className="mx-auto mb-1 text-gold" />
          <p className="font-display text-2xl font-bold text-gold">{totalCount}</p>
          <p className="text-xs text-muted">{t("إجمالي التنفيذات", "Total Executions")}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <CheckCircle2 size={18} className="mx-auto mb-1 text-emerald-400" />
          <p className="font-display text-2xl font-bold text-emerald-400">{successCount}</p>
          <p className="text-xs text-muted">{t("ناجحة", "Successful")}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <XCircle size={18} className="mx-auto mb-1 text-red-400" />
          <p className={`font-display text-2xl font-bold ${failedCount > 0 ? "text-red-400" : "text-muted"}`}>
            {failedCount}
          </p>
          <p className="text-xs text-muted">{t("فاشلة", "Failed")}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <TrendingUp size={18} className="mx-auto mb-1 text-blue-400" />
          <p className="font-display text-2xl font-bold text-blue-400">{successRate}%</p>
          <p className="text-xs text-muted">{t("نسبة النجاح", "Success Rate")}</p>
        </div>
      </div>

      {/* Section B: Execution Timeline Chart */}
      <div className="glass-card p-4">
        <h3 className="mb-3 text-sm font-semibold">{t("التنفيذات خلال 7 أيام", "Executions over 7 days")}</h3>
        <AnalyticsChart
          data={chartData}
          title={t("التنفيذات خلال 7 أيام", "Executions over 7 days")}
          unit="#"
        />
      </div>

      {/* Section C: Failure Breakdown */}
      <BreakdownBar
        title={t("توزيع الأخطاء حسب Workflow", "Error Distribution by Workflow")}
        segments={failureSegments}
        total={failedCount}
        emptyMessage={t("لا توجد أخطاء", "No errors")}
      />

      {/* Section D: Recurring Failure Alerts */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Flame size={16} className="text-red-400" />
          {t("تنبيهات الأعطال المتكررة", "Recurring Failure Alerts")}
        </h3>
        {recurringAlerts.length > 0 ? (
          <div className="space-y-2">
            {recurringAlerts.map((alert) => (
              <div
                key={alert.workflowId}
                className="glass-card border-red-500/20 bg-red-500/5 p-4"
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle size={18} className="shrink-0 text-red-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-red-400">
                      Workflow #{alert.workflowId}
                    </p>
                    <p className="text-xs text-muted">
                      {t(`${alert.count} فشل في الساعة الأخيرة`, `${alert.count} failures in the last hour`)}
                      {" — "}
                      {t("آخر فشل", "Latest")}: {new Date(alert.latest).toLocaleString(locale)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-card p-6 text-center">
            <CheckCircle2 size={24} className="mx-auto mb-2 text-emerald-400" />
            <p className="text-sm text-emerald-400">{t("لا توجد أخطاء متكررة", "No recurring failures")}</p>
          </div>
        )}
      </div>

      {/* Section E: Recent Failed Executions */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">
          {t("آخر التنفيذات الفاشلة", "Recent Failed Executions")}
        </h3>
        {recentFailed.length > 0 ? (
          <div className="glass-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-xs text-muted">
                    <th className="px-4 py-2.5 text-start font-medium">{t("رقم التنفيذ", "Execution ID")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("Workflow", "Workflow")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("الوقت", "Time")}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{t("تفاصيل", "Details")}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFailed.map((ex) => (
                    <tr key={ex.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 text-xs font-medium">#{ex.id}</td>
                      <td className="px-4 py-2.5 text-xs text-muted">#{ex.workflowId}</td>
                      <td className="px-4 py-2.5 text-xs text-muted">
                        {new Date(ex.startedAt).toLocaleString(locale)}
                      </td>
                      <td className="px-4 py-2.5 text-end">
                        <button
                          type="button"
                          onClick={() => startTransition(() => setSelectedExecId(ex.id))}
                          className="glass-pill inline-flex items-center gap-1 px-2.5 py-1 text-xs text-gold transition-colors hover:bg-gold/10"
                        >
                          <Eye size={12} />
                          {t("عرض", "View")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="glass-card p-6 text-center text-muted">
            <CheckCircle2 size={24} className="mx-auto mb-2 text-emerald-400" />
            <p className="text-sm text-emerald-400">{t("لا توجد تنفيذات فاشلة", "No failed executions")}</p>
          </div>
        )}
      </div>

      {/* Execution Detail Modal */}
      {selectedExecId && (
        <ExecutionDetailModal
          executionId={selectedExecId}
          onClose={() => startTransition(() => setSelectedExecId(null))}
        />
      )}
    </div>
  );
}
