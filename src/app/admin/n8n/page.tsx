"use client";

import { useState, useEffect, useCallback, startTransition } from "react";
import { Activity, Power, PowerOff, Search, AlertTriangle, CheckCircle, RefreshCw, XCircle, Filter } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface Workflow {
  id: string;
  name: string;
  active: boolean;
}

interface Execution {
  id: string;
  workflowId: string;
  status: string;
  startedAt: string;
}

export default function N8nControlPage() {
  const { t } = useLang();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showFailedOnly, setShowFailedOnly] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartResult, setRestartResult] = useState<string | null>(null);

  const loadData = useCallback(() => {
    startTransition(() => setLoading(true));
    Promise.all([
      fetch("/api/n8n/workflows").then(r => r.json()),
      fetch("/api/n8n/executions").then(r => r.json()),
    ]).then(([wfRes, exRes]) => {
      startTransition(() => {
        if (wfRes.data) setWorkflows(wfRes.data);
        if (exRes.data) setExecutions(exRes.data);
        setError(null);
        setLoading(false);
      });
    }).catch(err => {
      startTransition(() => { setError(String(err)); setLoading(false); });
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Map: workflowId → latest error
  const errorMap = new Map<string, string>();
  for (const ex of executions) {
    if (ex.status === "error" && !errorMap.has(ex.workflowId)) {
      errorMap.set(ex.workflowId, new Date(ex.startedAt).toLocaleString("ar-SA"));
    }
  }

  const failedWorkflowIds = new Set(errorMap.keys());
  const totalFailed = failedWorkflowIds.size;

  // Filter
  const filtered = workflows
    .filter(wf => {
      if (search && !wf.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (showFailedOnly && !failedWorkflowIds.has(wf.id)) return false;
      return true;
    })
    .sort((a, b) => {
      // Failed first, then active, then inactive
      const aFail = failedWorkflowIds.has(a.id) ? 0 : 1;
      const bFail = failedWorkflowIds.has(b.id) ? 0 : 1;
      if (aFail !== bFail) return aFail - bFail;
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  async function handleToggle(id: string, active: boolean) {
    setTogglingId(id);
    try {
      await fetch("/api/n8n/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active }),
      });
      setWorkflows(prev => prev.map(w => w.id === id ? { ...w, active } : w));
    } catch { /* silent */ }
    setTogglingId(null);
  }

  async function handleAutoRestart() {
    setRestarting(true);
    setRestartResult(null);
    try {
      const res = await fetch("/api/n8n/auto-restart", { method: "POST" });
      const data = await res.json();
      setRestartResult(
        data.restarted > 0
          ? t(`تم إعادة تشغيل ${data.restarted} workflows`, `Restarted ${data.restarted} workflows`)
          : t("لا توجد workflows تحتاج إعادة تشغيل", "No workflows need restart")
      );
      loadData();
    } catch {
      setRestartResult(t("فشل إعادة التشغيل", "Restart failed"));
    }
    setRestarting(false);
  }

  const activeCount = workflows.filter(w => w.active).length;
  const lastExecution = executions[0]?.startedAt
    ? new Date(executions[0].startedAt).toLocaleString("ar-SA")
    : "—";

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={24} className="text-gold" />
          <h1 className="text-xl font-bold">{t("تحكم n8n", "n8n Control")}</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={loadData} disabled={loading} className="glass-pill flex items-center gap-1 px-3 py-1.5 text-xs text-muted transition-colors hover:text-gold disabled:opacity-50">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            {t("تحديث", "Refresh")}
          </button>
          <button type="button" onClick={handleAutoRestart} disabled={restarting} className="glass-gold glass-pill flex items-center gap-1 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-primary-hover disabled:opacity-50">
            <RefreshCw size={12} className={restarting ? "animate-spin" : ""} />
            {t("إعادة تشغيل تلقائي", "Auto-Restart")}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
      )}
      {restartResult && (
        <div className="mb-4 rounded-xl border border-gold/30 bg-gold/10 p-3 text-sm text-gold">{restartResult}</div>
      )}

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="glass-card p-4 text-center">
          <p className="font-display text-2xl font-bold text-gold">{workflows.length}</p>
          <p className="text-xs text-muted">{t("إجمالي Workflows", "Total Workflows")}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="font-display text-2xl font-bold text-emerald-400">{activeCount}</p>
          <p className="text-xs text-muted">{t("نشطة", "Active")}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className={`font-display text-2xl font-bold ${totalFailed > 0 ? "text-red-400" : "text-muted"}`}>{totalFailed}</p>
          <p className="text-xs text-muted">{t("فاشلة", "Failed")}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-xs font-medium text-gold">{lastExecution}</p>
          <p className="text-xs text-muted">{t("آخر تنفيذ", "Last Execution")}</p>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("بحث بالاسم...", "Search by name...")}
            aria-label={t("بحث", "Search")}
            className="glass-input w-full rounded-xl ps-9 pe-4 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFailedOnly(!showFailedOnly)}
          className={`glass-pill flex items-center gap-1 px-3 py-2 text-xs transition-colors ${
            showFailedOnly ? "bg-red-500/10 text-red-400 border-red-500/30" : "text-muted hover:text-gold"
          }`}
        >
          <Filter size={12} />
          {showFailedOnly ? t("الفاشلة فقط", "Failed Only") : t("الكل", "All")}
        </button>
      </div>

      {/* Workflows List */}
      {loading && workflows.length === 0 ? (
        <div className="glass-card p-12 text-center text-muted">
          <RefreshCw size={24} className="mx-auto mb-2 animate-spin" />
          {t("جاري التحميل...", "Loading...")}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(wf => {
            const hasError = errorMap.has(wf.id);
            const errorTime = errorMap.get(wf.id);

            return (
              <div key={wf.id} className={`glass-card flex items-center gap-3 p-4 ${hasError ? "border-red-500/20" : ""}`}>
                {/* Status indicator */}
                <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${wf.active ? "bg-emerald-400" : "bg-muted/30"}`} />

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{wf.name}</p>
                  {hasError && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-red-400">
                      <XCircle size={10} />
                      {t("خطأ في", "Error at")} {errorTime}
                    </p>
                  )}
                </div>

                {/* Toggle button */}
                <button
                  type="button"
                  onClick={() => handleToggle(wf.id, !wf.active)}
                  disabled={togglingId === wf.id}
                  className={`glass-pill flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    wf.active
                      ? "text-emerald-400 hover:bg-red-500/10 hover:text-red-400"
                      : "text-muted hover:bg-emerald-500/10 hover:text-emerald-400"
                  }`}
                >
                  {togglingId === wf.id ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : wf.active ? (
                    <><PowerOff size={12} /> {t("إيقاف", "Stop")}</>
                  ) : (
                    <><Power size={12} /> {t("تشغيل", "Start")}</>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
