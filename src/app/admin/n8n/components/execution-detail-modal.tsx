"use client";

import { useState, useEffect, useRef, startTransition } from "react";
import { X, RefreshCw, Clock, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface ExecutionDetailModalProps {
  executionId: string;
  onClose: () => void;
}

interface NodeRunData {
  startTime: number;
  executionTime: number;
  executionStatus?: "success" | "error";
  error?: { message: string; stack?: string };
  data?: unknown;
}

interface ExecutionDetail {
  id: string;
  status: string;
  startedAt: string;
  stoppedAt: string | null;
  workflowId: string;
  data?: {
    resultData?: {
      runData?: Record<string, NodeRunData[]>;
      lastNodeExecuted?: string;
      error?: { message: string; stack?: string };
    };
  };
}

export function ExecutionDetailModal({ executionId, onClose }: ExecutionDetailModalProps) {
  const { t, lang } = useLang();
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchDetail() {
      try {
        const res = await fetch(`/api/n8n/execution/${executionId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data: ExecutionDetail = await res.json();
        if (!cancelled) {
          startTransition(() => {
            setDetail(data);
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

    fetchDetail();
    return () => { cancelled = true; };
  }, [executionId]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Click outside to close
  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  function formatDuration(startedAt: string, stoppedAt: string | null): string {
    if (!stoppedAt) return "—";
    const ms = new Date(stoppedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const resultError = detail?.data?.resultData?.error;
  const runData = detail?.data?.resultData?.runData;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="glass-card relative max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute end-4 top-4 rounded-lg p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
          aria-label={t("إغلاق", "Close")}
        >
          <X size={18} />
        </button>

        <h2 className="mb-4 text-lg font-bold">
          {t("تفاصيل التنفيذ", "Execution Details")}
        </h2>

        {loading && (
          <div className="py-12 text-center text-muted">
            <RefreshCw size={24} className="mx-auto mb-2 animate-spin" />
            <p className="text-sm">{t("جاري التحميل...", "Loading...")}</p>
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}

        {detail && !loading && (
          <div className="space-y-5">
            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="glass-card p-3 text-center">
                <p className="text-xs text-muted">{t("رقم التنفيذ", "Execution ID")}</p>
                <p className="mt-1 text-sm font-medium">#{detail.id}</p>
              </div>
              <div className="glass-card p-3 text-center">
                <p className="text-xs text-muted">{t("الحالة", "Status")}</p>
                <p className={`mt-1 text-sm font-medium ${detail.status === "error" ? "text-red-400" : detail.status === "success" ? "text-emerald-400" : "text-amber-400"}`}>
                  {detail.status === "error" ? t("فشل", "Failed") :
                    detail.status === "success" ? t("نجح", "Success") :
                    detail.status}
                </p>
              </div>
              <div className="glass-card p-3 text-center">
                <p className="text-xs text-muted">{t("المدة", "Duration")}</p>
                <p className="mt-1 text-sm font-medium">
                  <Clock size={12} className="me-1 inline" />
                  {formatDuration(detail.startedAt, detail.stoppedAt)}
                </p>
              </div>
              <div className="glass-card p-3 text-center">
                <p className="text-xs text-muted">{t("Workflow", "Workflow")}</p>
                <p className="mt-1 text-sm font-medium">#{detail.workflowId}</p>
              </div>
            </div>

            {/* Timestamps */}
            <div className="flex flex-wrap gap-4 text-xs text-muted">
              <span>
                {t("بدأ في", "Started at")}:{" "}
                <span className="text-foreground">
                  {new Date(detail.startedAt).toLocaleString(locale)}
                </span>
              </span>
              {detail.stoppedAt && (
                <span>
                  {t("انتهى في", "Stopped at")}:{" "}
                  <span className="text-foreground">
                    {new Date(detail.stoppedAt).toLocaleString(locale)}
                  </span>
                </span>
              )}
            </div>

            {/* Error Section */}
            {resultError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <AlertTriangle size={16} className="text-red-400" />
                  <h3 className="text-sm font-semibold text-red-400">{t("خطأ في التنفيذ", "Execution Error")}</h3>
                </div>
                <p className="mb-2 text-sm text-red-300">{resultError.message}</p>
                {resultError.stack && (
                  <pre className="glass-input max-h-48 overflow-auto rounded-lg p-3 text-xs text-muted">
                    {resultError.stack}
                  </pre>
                )}
              </div>
            )}

            {/* Node Run Data */}
            {runData && Object.keys(runData).length > 0 && (
              <div>
                <h3 className="mb-3 text-sm font-semibold">{t("تفاصيل العقد", "Node Details")}</h3>
                <div className="space-y-1.5">
                  {Object.entries(runData).map(([nodeName, runs]) => {
                    const run = runs[0];
                    if (!run) return null;
                    const hasError = !!run.error;
                    return (
                      <div
                        key={nodeName}
                        className={`glass-card flex items-center gap-3 p-3 ${hasError ? "border-red-500/20" : ""}`}
                      >
                        {hasError ? (
                          <XCircle size={16} className="shrink-0 text-red-400" />
                        ) : (
                          <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-medium ${hasError ? "text-red-400" : ""}`}>
                            {nodeName}
                          </p>
                          {hasError && run.error?.message && (
                            <p className="mt-0.5 truncate text-xs text-red-400/80">{run.error.message}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-xs text-muted">
                          {run.executionTime < 1000
                            ? `${run.executionTime}ms`
                            : `${(run.executionTime / 1000).toFixed(1)}s`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
