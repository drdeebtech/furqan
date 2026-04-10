"use client";

import { useState, startTransition } from "react";
import {
  ShieldCheck,
  RefreshCw,
  Copy,
  KeyRound,
  Unplug,
  AlertTriangle,
  Link2Off,
  Flame,
  BellOff,
} from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { SeverityBadge } from "./severity-badge";
import type { AuditReport, AuditIssue, IssueCategory } from "@/lib/n8n/audit";

const categoryLabels: Record<IssueCategory, { ar: string; en: string }> = {
  duplicate: { ar: "مكرر", en: "Duplicate" },
  hardcoded_secret: { ar: "مفتاح مضمن", en: "Hardcoded Secret" },
  broken_node: { ar: "عقدة معطلة", en: "Broken Node" },
  credential_issue: { ar: "مشكلة بيانات اعتماد", en: "Credential Issue" },
  missing_connection: { ar: "اتصال مفقود", en: "Missing Connection" },
  recurring_failure: { ar: "فشل متكرر", en: "Recurring Failure" },
  inactive_alert: { ar: "تنبيه غير نشط", en: "Inactive Alert" },
};

const summaryCards: {
  key: keyof AuditReport["summary"];
  ar: string;
  en: string;
  icon: typeof Copy;
}[] = [
  { key: "duplicates", ar: "مكررات", en: "Duplicates", icon: Copy },
  { key: "hardcodedSecrets", ar: "مفاتيح مضمنة", en: "Hardcoded Secrets", icon: KeyRound },
  { key: "brokenNodes", ar: "عقد معطلة", en: "Broken Nodes", icon: Unplug },
  { key: "credentialIssues", ar: "مشاكل بيانات اعتماد", en: "Credential Issues", icon: AlertTriangle },
  { key: "missingConnections", ar: "اتصالات مفقودة", en: "Missing Connections", icon: Link2Off },
  { key: "recurringFailures", ar: "أعطال متكررة", en: "Recurring Failures", icon: Flame },
];

function scoreColor(score: number): string {
  if (score > 80) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score > 80) return "bg-emerald-500/15 border-emerald-500/30";
  if (score >= 50) return "bg-amber-500/15 border-amber-500/30";
  return "bg-red-500/15 border-red-500/30";
}

export function HealthAuditTab() {
  const { t } = useLang();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAudit() {
    startTransition(() => {
      setLoading(true);
      setError(null);
    });
    try {
      const res = await fetch("/api/n8n/audit", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: AuditReport = await res.json();
      startTransition(() => {
        setReport(data);
        setLoading(false);
      });
    } catch (err) {
      startTransition(() => {
        setError(String(err));
        setLoading(false);
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Run Audit Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-gold" />
          <h2 className="text-lg font-bold">{t("فحص صحة Workflows", "Workflow Health Audit")}</h2>
        </div>
        <button
          type="button"
          onClick={runAudit}
          disabled={loading}
          className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {loading ? t("جاري الفحص...", "Scanning...") : t("فحص الآن", "Run Audit")}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="glass-card p-12 text-center text-muted">
          <RefreshCw size={28} className="mx-auto mb-3 animate-spin text-gold" />
          <p className="text-sm">{t("جاري فحص جميع الـ Workflows... قد يستغرق عدة ثوانٍ", "Scanning all workflows... this may take a few seconds")}</p>
        </div>
      )}

      {report && (
        <>
          {/* Section A: Aggregate Health Score */}
          <div className="glass-card flex flex-col items-center p-8">
            <p className={`font-display text-6xl font-extrabold ${scoreColor(report.overallScore)}`}>
              {report.overallScore}
            </p>
            <p className="mt-2 text-sm text-muted">{t("الصحة العامة", "Overall Health")}</p>
            <p className="mt-1 text-xs text-muted">
              {t(
                `${report.summary.totalWorkflows} workflow — ${report.summary.activeWorkflows} نشط`,
                `${report.summary.totalWorkflows} workflows — ${report.summary.activeWorkflows} active`,
              )}
            </p>
          </div>

          {/* Section B: Summary Stats Row */}
          <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
            {summaryCards.map(({ key, ar, en, icon: Icon }) => {
              const count = report.summary[key] as number;
              return (
                <div key={key} className="glass-card p-3 text-center">
                  <Icon
                    size={18}
                    className={`mx-auto mb-1 ${count > 0 ? "text-red-400" : "text-muted/50"}`}
                  />
                  <p className={`font-display text-xl font-bold ${count > 0 ? "text-red-400" : "text-muted"}`}>
                    {count}
                  </p>
                  <p className="text-[10px] text-muted leading-tight">{t(ar, en)}</p>
                </div>
              );
            })}
          </div>

          {/* Section C: Issues Table */}
          {report.issues.length > 0 && (
            <div className="glass-card overflow-hidden p-0">
              <div className="border-b border-white/5 px-4 py-3">
                <h3 className="text-sm font-semibold">
                  {t("المشاكل المكتشفة", "Detected Issues")} ({report.issues.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-xs text-muted">
                      <th className="px-4 py-2.5 text-start font-medium">{t("الخطورة", "Severity")}</th>
                      <th className="px-4 py-2.5 text-start font-medium">{t("الفئة", "Category")}</th>
                      <th className="px-4 py-2.5 text-start font-medium">{t("Workflow", "Workflow")}</th>
                      <th className="px-4 py-2.5 text-start font-medium">{t("العقدة", "Node")}</th>
                      <th className="px-4 py-2.5 text-start font-medium">{t("الرسالة", "Message")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.issues.map((issue: AuditIssue, i: number) => (
                      <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                        <td className="px-4 py-2.5">
                          <SeverityBadge severity={issue.severity} />
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {t(
                            categoryLabels[issue.category]?.ar ?? issue.category,
                            categoryLabels[issue.category]?.en ?? issue.category,
                          )}
                        </td>
                        <td className="max-w-[160px] truncate px-4 py-2.5 text-xs" title={issue.workflowName}>
                          {issue.workflowName}
                        </td>
                        <td className="max-w-[120px] truncate px-4 py-2.5 text-xs text-muted" title={issue.node ?? ""}>
                          {issue.node ?? "—"}
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-muted" title={issue.message}>
                          {issue.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {report.issues.length === 0 && (
            <div className="glass-card p-8 text-center">
              <ShieldCheck size={32} className="mx-auto mb-2 text-emerald-400" />
              <p className="text-sm text-emerald-400">{t("لا توجد مشاكل مكتشفة!", "No issues detected!")}</p>
            </div>
          )}

          {/* Section D: Per-Workflow Health Scores */}
          <div>
            <h3 className="mb-3 text-sm font-semibold">
              {t("صحة كل Workflow", "Per-Workflow Health")}
            </h3>
            <div className="space-y-2">
              {report.workflows.map((wf) => (
                <div
                  key={wf.workflowId}
                  className="glass-card flex items-center gap-3 p-3"
                >
                  {/* Score badge */}
                  <span
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${scoreBg(wf.score)} ${scoreColor(wf.score)}`}
                  >
                    {wf.score}
                  </span>

                  {/* Name + details */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={wf.workflowName}>
                      {wf.workflowName}
                    </p>
                    <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-muted">
                      <span>
                        {t("نسبة النجاح", "Success Rate")}: {(wf.successRate * 100).toFixed(0)}%
                      </span>
                      <span>
                        {t("مشاكل", "Issues")}: {wf.issues.length}
                      </span>
                      <span>
                        {t("تنفيذات", "Executions")}: {wf.executionCount}
                      </span>
                    </div>
                  </div>

                  {/* Active indicator */}
                  <div
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${wf.active ? "bg-emerald-400" : "bg-muted/30"}`}
                    title={wf.active ? t("نشط", "Active") : t("متوقف", "Inactive")}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
