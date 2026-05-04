"use client";

import { useState, useEffect, useCallback, startTransition } from "react";
import {
  Power,
  PowerOff,
  Search,
  RefreshCw,
  XCircle,
  Filter,
  CheckCircle2,
  HeartPulse,
  ExternalLink,
} from "lucide-react";

const N8N_UI_BASE =
  process.env.NEXT_PUBLIC_N8N_UI_URL ?? "https://n8n.drdeeb.tech";
import { useLang, type Lang } from "@/lib/i18n/context";
import { toggleWorkflowAction, autoRestartAction } from "@/lib/n8n/actions";
import {
  getWorkflowMeta,
  WORKFLOW_AREAS,
  type WorkflowArea,
} from "@/lib/n8n/workflow-descriptions";

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

export function OverviewTab() {
  const { t, lang } = useLang();
  const locale = lang === "ar" ? "ar" : "en-US";
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [errorExecutions, setErrorExecutions] = useState<Execution[]>([]);
  const [allExecutions, setAllExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showFailedOnly, setShowFailedOnly] = useState(false);
  const [groupByArea, setGroupByArea] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartResult, setRestartResult] = useState<string | null>(null);

  const loadData = useCallback(() => {
    startTransition(() => setLoading(true));
    // Capture { ok, status, body } per response so a 500 with { error } isn't
    // silently dropped (the prior `r.json()` flow swallowed errors and then
    // unconditionally cleared the banner).
    const parse = async (r: Response) => ({
      ok: r.ok,
      status: r.status,
      body: (await r.json().catch(() => null)) as
        | { data?: unknown; error?: string }
        | null,
    });
    Promise.all([
      fetch("/api/n8n/workflows").then(parse),
      fetch("/api/n8n/executions").then(parse),
      fetch("/api/n8n/executions/all").then(parse),
    ])
      .then(([wfRes, exRes, allExRes]) => {
        startTransition(() => {
          const labelled: Array<[string, typeof wfRes]> = [
            ["workflows", wfRes],
            ["executions", exRes],
            ["all-executions", allExRes],
          ];
          const failures = labelled.filter(([, r]) => !r.ok);
          if (failures.length > 0) {
            const auth = failures.find(([, r]) => r.status === 401 || r.status === 403);
            if (auth) {
              setError(t("الجلسة منتهية — أعد تسجيل الدخول", "Session expired — please log in again"));
            } else {
              const messages = failures.map(([name, r]) => {
                const upstream = r.body?.error?.trim() || t("لا توجد رسالة", "no message");
                return `${name} [${r.status}]: ${upstream}`;
              });
              const dedup = Array.from(new Set(messages));
              setError(dedup.join(" — "));
            }
          } else {
            setError(null);
          }

          if (wfRes.ok && Array.isArray(wfRes.body?.data)) {
            setWorkflows(wfRes.body.data as Workflow[]);
          }
          if (exRes.ok && Array.isArray(exRes.body?.data)) {
            setErrorExecutions(exRes.body.data as Execution[]);
          }
          if (allExRes.ok && Array.isArray(allExRes.body?.data)) {
            setAllExecutions(allExRes.body.data as Execution[]);
          }
          setLoading(false);
        });
      })
      .catch((err) => {
        startTransition(() => {
          setError(String(err));
          setLoading(false);
        });
      });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // n8n's /executions endpoint returns newest-first, so the first occurrence
  // per workflowId is the latest. We derive three maps:
  //   - latestExecMap:   most recent execution status per workflow
  //   - lastSuccessMap:  timestamp of last green run (context for broken rows)
  //   - lastErrorMap:    timestamp of last red run (rendered when broken)
  const latestExecMap = new Map<string, Execution>();
  const lastSuccessMap = new Map<string, string>();
  const lastErrorMap = new Map<string, string>();
  for (const ex of allExecutions) {
    if (!latestExecMap.has(ex.workflowId)) latestExecMap.set(ex.workflowId, ex);
    if (ex.status === "success" && !lastSuccessMap.has(ex.workflowId)) {
      lastSuccessMap.set(ex.workflowId, new Date(ex.startedAt).toLocaleString(locale));
    }
    if (ex.status === "error" && !lastErrorMap.has(ex.workflowId)) {
      lastErrorMap.set(ex.workflowId, new Date(ex.startedAt).toLocaleString(locale));
    }
  }
  // Backfill error timestamps from the dedicated error feed for workflows
  // whose only failures pre-date allExecutions' window.
  for (const ex of errorExecutions) {
    if (ex.status === "error" && !lastErrorMap.has(ex.workflowId)) {
      lastErrorMap.set(ex.workflowId, new Date(ex.startedAt).toLocaleString(locale));
    }
  }

  // Compute per-workflow success rate from all executions
  const workflowStats = new Map<
    string,
    { total: number; success: number }
  >();
  for (const ex of allExecutions) {
    const stats = workflowStats.get(ex.workflowId) ?? {
      total: 0,
      success: 0,
    };
    stats.total++;
    if (ex.status === "success") stats.success++;
    workflowStats.set(ex.workflowId, stats);
  }

  // "Currently broken" = the most recent execution we have on record errored.
  // This is what we want to surface as a red flag — a 5-day-old error on a
  // workflow that has succeeded 1,440 times since is just stale residue.
  const currentlyBrokenIds = new Set<string>();
  for (const [wfId, ex] of latestExecMap) {
    if (ex.status === "error") currentlyBrokenIds.add(wfId);
  }
  const failedWorkflowIds = currentlyBrokenIds;
  const totalFailed = failedWorkflowIds.size;

  // Compute overall success rate
  const totalExecutions = allExecutions.length;
  const totalSuccessful = allExecutions.filter(
    (e) => e.status === "success",
  ).length;
  const successRate =
    totalExecutions > 0
      ? Math.round((totalSuccessful / totalExecutions) * 100)
      : 0;

  // Compute health score: weighted formula
  // 50% success rate + 30% active ratio + 20% no recent failures penalty
  const activeCount = workflows.filter((w) => w.active).length;
  const activeRatio =
    workflows.length > 0 ? activeCount / workflows.length : 0;
  const failurePenalty =
    workflows.length > 0
      ? 1 - totalFailed / workflows.length
      : 1;
  const healthScore = Math.round(
    successRate * 0.5 + activeRatio * 100 * 0.3 + failurePenalty * 100 * 0.2,
  );

  // Filter
  const filtered = workflows
    .filter((wf) => {
      if (
        search &&
        !wf.name.toLowerCase().includes(search.toLowerCase())
      )
        return false;
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

  async function handleToggle(id: string, name: string, active: boolean) {
    if (
      !active &&
      !confirm(
        t(
          "هل تريد إيقاف هذا الـ workflow؟",
          "Stop this workflow?",
        ),
      )
    )
      return;
    setTogglingId(id);
    const result = await toggleWorkflowAction(id, name, active);
    if (result.success) {
      startTransition(() => {
        setWorkflows((prev) =>
          prev.map((w) => (w.id === id ? { ...w, active } : w)),
        );
      });
    }
    setTogglingId(null);
  }

  async function handleAutoRestart() {
    setRestarting(true);
    setRestartResult(null);
    try {
      const data = await autoRestartAction();
      startTransition(() => {
        setRestartResult(
          data.restarted > 0
            ? t(
                `تم إعادة تشغيل ${data.restarted} workflows`,
                `Restarted ${data.restarted} workflows`,
              )
            : t(
                "لا توجد workflows تحتاج إعادة تشغيل",
                "No workflows need restart",
              ),
        );
      });
      setTimeout(() => {
        startTransition(() => setRestartResult(null));
      }, 5000);
      loadData();
    } catch {
      startTransition(() => {
        setRestartResult(
          t("فشل إعادة التشغيل", "Restart failed"),
        );
      });
    }
    setRestarting(false);
  }

  // Most recent execution across all workflows (any status). Was previously
  // pulling from errorExecutions[0] which only showed the last *error* time
  // mislabeled as "Last Execution".
  const lastExecution = allExecutions[0]?.startedAt
    ? new Date(allExecutions[0].startedAt).toLocaleString(locale)
    : "\u2014";

  return (
    <div>
      {/* Action buttons */}
      <div className="mb-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="glass-pill flex items-center gap-1 px-3 py-2 sm:py-1.5 text-xs text-muted transition-colors hover:text-gold disabled:opacity-50"
        >
          <RefreshCw
            size={12}
            className={loading ? "animate-spin" : ""}
          />
          {t("تحديث", "Refresh")}
        </button>
        <button
          type="button"
          onClick={handleAutoRestart}
          disabled={restarting}
          className="glass-gold glass-pill flex items-center gap-1 px-4 py-2 sm:py-1.5 text-xs font-semibold transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          <RefreshCw
            size={12}
            className={restarting ? "animate-spin" : ""}
          />
          {t("إعادة تشغيل تلقائي", "Auto-Restart")}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error"
        >
          {error}
        </div>
      )}
      {restartResult && (
        <div
          aria-live="polite"
          className="mb-4 rounded-xl border border-gold/30 bg-gold/10 p-3 text-sm text-gold"
        >
          {restartResult}
        </div>
      )}

      {/* Stats — 6 cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="glass-card p-4 text-center">
          <p className="font-display text-2xl font-bold text-gold">
            {workflows.length}
          </p>
          <p className="text-xs text-muted">
            {t("إجمالي Workflows", "Total Workflows")}
          </p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="font-display text-2xl font-bold text-success">
            {activeCount}
          </p>
          <p className="text-xs text-muted">
            {t("نشطة", "Active")}
          </p>
        </div>
        <div className="glass-card p-4 text-center">
          <p
            className={`font-display text-2xl font-bold ${totalFailed > 0 ? "text-red-400" : "text-muted"}`}
          >
            {totalFailed}
          </p>
          <p className="text-xs text-muted">
            {t("فاشلة", "Failed")}
          </p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-xs font-medium text-gold">
            {lastExecution}
          </p>
          <p className="text-xs text-muted">
            {t("آخر تنفيذ", "Last Execution")}
          </p>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="flex items-center justify-center gap-1">
            <CheckCircle2
              size={16}
              className={
                successRate >= 80
                  ? "text-success"
                  : successRate >= 50
                    ? "text-warning"
                    : "text-red-400"
              }
            />
            <p
              className={`font-display text-2xl font-bold ${
                successRate >= 80
                  ? "text-success"
                  : successRate >= 50
                    ? "text-warning"
                    : "text-red-400"
              }`}
            >
              {successRate}%
            </p>
          </div>
          <p className="text-xs text-muted">
            {t("معدل النجاح", "Success Rate")}
          </p>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="flex items-center justify-center gap-1">
            <HeartPulse
              size={16}
              className={
                healthScore >= 80
                  ? "text-success"
                  : healthScore >= 50
                    ? "text-warning"
                    : "text-red-400"
              }
            />
            <p
              className={`font-display text-2xl font-bold ${
                healthScore >= 80
                  ? "text-success"
                  : healthScore >= 50
                    ? "text-warning"
                    : "text-red-400"
              }`}
            >
              {healthScore}
            </p>
          </div>
          <p className="text-xs text-muted">
            {t("نقاط الصحة", "Health Score")}
          </p>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-muted"
          />
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
            showFailedOnly
              ? "bg-error/10 text-red-400 border-error/30"
              : "text-muted hover:text-gold"
          }`}
        >
          <Filter size={12} />
          {showFailedOnly
            ? t("الفاشلة فقط", "Failed Only")
            : t("الكل", "All")}
        </button>
        <button
          type="button"
          onClick={() => setGroupByArea(!groupByArea)}
          aria-pressed={groupByArea}
          className={`glass-pill flex items-center gap-1 px-3 py-2 text-xs transition-colors ${
            groupByArea
              ? "bg-gold/10 text-gold border-gold/30"
              : "text-muted hover:text-gold"
          }`}
        >
          <Filter size={12} />
          {t("تجميع حسب المجال", "Group by area")}
        </button>
      </div>

      {/* Workflows List */}
      {loading && workflows.length === 0 ? (
        <div className="glass-card p-12 text-center text-muted">
          <RefreshCw size={24} className="mx-auto mb-2 animate-spin" />
          {t("جاري التحميل...", "Loading...")}
        </div>
      ) : groupByArea ? (
        <div className="space-y-6">
          {groupWorkflowsByArea(filtered).map(({ area, items }) => {
            const areaLabel = area
              ? WORKFLOW_AREAS[area][lang === "ar" ? "ar" : "en"]
              : t("غير مصنّف", "Other");
            return (
              <section key={area ?? "other"}>
                <h3 className="mb-2 sticky top-0 z-10 -mx-2 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gold/80 backdrop-blur-sm bg-bg/60 rounded">
                  {areaLabel}{" "}
                  <span className="text-muted/60 normal-case">
                    ({items.length})
                  </span>
                </h3>
                <div className="space-y-2">
                  {items.map((wf) => (
                    <WorkflowRow
                      key={wf.id}
                      wf={wf}
                      lang={lang}
                      t={t}
                      currentlyBroken={currentlyBrokenIds.has(wf.id)}
                      lastErrorTime={lastErrorMap.get(wf.id)}
                      lastSuccessTime={lastSuccessMap.get(wf.id)}
                      successRate={successRateFor(wf.id, workflowStats)}
                      togglingId={togglingId}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {filtered.length === 0 && !loading && (
            <div className="glass-card p-8 text-center text-muted">
              <Search size={20} className="mx-auto mb-2 text-muted/30" />
              <p className="text-sm">
                {showFailedOnly
                  ? t("لا توجد workflows فاشلة", "No failed workflows")
                  : t("لا توجد نتائج للبحث", "No results found")}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((wf) => (
            <WorkflowRow
              key={wf.id}
              wf={wf}
              lang={lang}
              t={t}
              currentlyBroken={currentlyBrokenIds.has(wf.id)}
              lastErrorTime={lastErrorMap.get(wf.id)}
              lastSuccessTime={lastSuccessMap.get(wf.id)}
              successRate={successRateFor(wf.id, workflowStats)}
              togglingId={togglingId}
              onToggle={handleToggle}
            />
          ))}
          {filtered.length === 0 && !loading && (
            <div className="glass-card p-8 text-center text-muted">
              <Search size={20} className="mx-auto mb-2 text-muted/30" />
              <p className="text-sm">
                {showFailedOnly
                  ? t("لا توجد workflows فاشلة", "No failed workflows")
                  : t("لا توجد نتائج للبحث", "No results found")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function successRateFor(
  id: string,
  stats: Map<string, { total: number; success: number }>,
): number | null {
  const s = stats.get(id);
  if (!s || s.total === 0) return null;
  return Math.round((s.success / s.total) * 100);
}

function groupWorkflowsByArea(
  workflows: Workflow[],
): Array<{ area: WorkflowArea | null; items: Workflow[] }> {
  const buckets = new Map<WorkflowArea | "__other__", Workflow[]>();
  for (const wf of workflows) {
    const meta = getWorkflowMeta(wf.name);
    const key = meta?.area ?? "__other__";
    const list = buckets.get(key) ?? [];
    list.push(wf);
    buckets.set(key, list);
  }
  const order: WorkflowArea[] = [
    "session_lifecycle",
    "parent_communication",
    "retention",
    "revenue",
    "teacher_onboarding",
    "teacher_quality",
    "booking_intelligence",
    "messaging",
    "admin_operations",
    "payments",
    "platform_health",
    "ai_intelligence",
  ];
  const out: Array<{ area: WorkflowArea | null; items: Workflow[] }> = [];
  for (const area of order) {
    const items = buckets.get(area);
    if (items?.length) out.push({ area, items });
  }
  const other = buckets.get("__other__");
  if (other?.length) out.push({ area: null, items: other });
  return out;
}

interface WorkflowRowProps {
  wf: Workflow;
  lang: Lang;
  t: (ar: string, en: string) => string;
  currentlyBroken: boolean;
  lastErrorTime: string | undefined;
  lastSuccessTime: string | undefined;
  successRate: number | null;
  togglingId: string | null;
  onToggle: (id: string, name: string, active: boolean) => void;
}

function WorkflowRow({
  wf,
  lang,
  t,
  currentlyBroken,
  lastErrorTime,
  lastSuccessTime,
  successRate,
  togglingId,
  onToggle,
}: WorkflowRowProps) {
  const meta = getWorkflowMeta(wf.name);
  const purpose = meta ? (lang === "ar" ? meta.ar : meta.en) : null;
  const areaLabel = meta
    ? WORKFLOW_AREAS[meta.area][lang === "ar" ? "ar" : "en"]
    : null;

  return (
    <div
      className={`glass-card flex items-start gap-3 p-4 ${currentlyBroken ? "border-error/20" : ""}`}
    >
      <div
        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${wf.active ? "bg-emerald-400" : "bg-muted/30"}`}
      >
        <span className="sr-only">
          {wf.active ? t("نشط", "Active") : t("متوقف", "Inactive")}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`${N8N_UI_BASE}/workflow/${wf.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1 text-sm font-medium hover:text-gold"
            title={t("افتح في n8n", "Open in n8n")}
          >
            {wf.name}
            <ExternalLink
              size={11}
              className="text-muted/60 transition-colors group-hover:text-gold"
            />
          </a>
          {areaLabel && (
            <span className="inline-flex items-center rounded-full border border-gold/20 bg-gold/5 px-1.5 py-0.5 text-[10px] font-medium text-gold/80">
              {areaLabel}
            </span>
          )}
          {successRate !== null ? (
            <span
              className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                successRate >= 80
                  ? "bg-success/15 text-success border-success/30"
                  : successRate >= 50
                    ? "bg-warning/15 text-warning border-warning/30"
                    : "bg-error/15 text-red-400 border-error/30"
              }`}
            >
              {successRate}%
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-muted">
              {t("لم يُنفذ", "Not executed")}
            </span>
          )}
        </div>
        {purpose ? (
          <p
            className="mt-1 truncate text-xs text-muted"
            title={purpose}
          >
            {purpose}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted/50">—</p>
        )}
        {currentlyBroken ? (
          <>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-red-400">
              <XCircle size={10} />
              {t("آخر خطأ:", "Last error:")} {lastErrorTime ?? "—"}
            </p>
            {lastSuccessTime && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted/70">
                <CheckCircle2 size={10} />
                {t("آخر نجاح:", "Last success:")} {lastSuccessTime}
              </p>
            )}
          </>
        ) : lastSuccessTime ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted/70">
            <CheckCircle2 size={10} className="text-success/70" />
            {t("آخر تشغيل:", "Last run:")} {lastSuccessTime}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onToggle(wf.id, wf.name, !wf.active)}
        disabled={togglingId === wf.id}
        className={`glass-pill flex items-center gap-1 px-3 py-2 sm:py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
          wf.active
            ? "text-success hover:bg-error/10 hover:text-red-400"
            : "text-muted hover:bg-success/10 hover:text-success"
        }`}
      >
        {togglingId === wf.id ? (
          <RefreshCw size={12} className="animate-spin" />
        ) : wf.active ? (
          <>
            <PowerOff size={12} /> {t("إيقاف", "Stop")}
          </>
        ) : (
          <>
            <Power size={12} /> {t("تشغيل", "Start")}
          </>
        )}
      </button>
    </div>
  );
}
