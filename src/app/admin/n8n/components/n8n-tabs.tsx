"use client";

import { useState, useEffect, useRef, startTransition } from "react";
import dynamic from "next/dynamic";
import { Activity } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

// Each tab's code loads only when it's first activated, so opening /admin/n8n
// ships just the tab shell + overview tab — the other three (HealthAudit
// pulls recharts, ExecutionIntel pulls charts + heavy tables, AdminLog pulls
// data-table code) stay off the critical path.
const tabLoading = () => (
  <div className="mt-6 h-64 animate-pulse rounded-xl bg-surface/40" />
);
const OverviewTab = dynamic(() => import("./overview-tab").then((m) => m.OverviewTab), { loading: tabLoading });
const HealthAuditTab = dynamic(() => import("./health-audit-tab").then((m) => m.HealthAuditTab), { loading: tabLoading });
const ExecutionIntelTab = dynamic(() => import("./execution-intel-tab").then((m) => m.ExecutionIntelTab), { loading: tabLoading });
const AdminLogTab = dynamic(() => import("./admin-log-tab").then((m) => m.AdminLogTab), { loading: tabLoading });

const tabs = [
  { ar: "نظرة عامة", en: "Overview" },
  { ar: "فحص الصحة", en: "Health Audit" },
  { ar: "الذكاء التشغيلي", en: "Execution Intel" },
  { ar: "سجل الإدارة", en: "Admin Log" },
] as const;

function useRelativeTime(date: Date | null, t: (ar: string, en: string) => string) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!date) return;

    function update() {
      if (!date) return;
      const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
      if (seconds < 60) {
        setLabel(t(`منذ ${seconds} ثانية`, `${seconds}s ago`));
      } else {
        const minutes = Math.floor(seconds / 60);
        setLabel(t(`منذ ${minutes} دقيقة`, `${minutes}m ago`));
      }
    }

    update();
    const id = setInterval(update, 10_000);
    return () => clearInterval(id);
  }, [date, t]);

  return label;
}

export function N8nTabs() {
  const { t, dir } = useLang();
  const [activeTab, setActiveTab] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const isFirstRender = useRef(true);

  // Set lastUpdated when activeTab changes (each tab loads fresh data)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
    }
    startTransition(() => {
      setLastUpdated(new Date());
    });
  }, [activeTab]);

  const relativeTime = useRelativeTime(lastUpdated, t);

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Activity size={24} className="text-gold" />
        <h1 className="text-xl font-bold">
          {t("تحكم n8n", "n8n Control")}
        </h1>
      </div>

      {/* Tab bar */}
      <div className="glass mb-6 flex gap-1 rounded-xl p-1">
        {tabs.map((tab, idx) => (
          <button
            key={tab.en}
            type="button"
            onClick={() => setActiveTab(idx)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === idx
                ? "bg-gold/15 text-gold border border-gold/30"
                : "text-muted hover:text-[var(--foreground)]"
            }`}
          >
            {t(tab.ar, tab.en)}
          </button>
        ))}
      </div>

      {/* Last updated indicator */}
      {lastUpdated && (
        <p className="mb-4 text-xs text-muted">
          {t("آخر تحديث", "Last updated")}: {relativeTime}
        </p>
      )}

      {/* Tab content — lazy render: only mount active tab */}
      {activeTab === 0 && <OverviewTab />}
      {activeTab === 1 && <HealthAuditTab />}
      {activeTab === 2 && <ExecutionIntelTab />}
      {activeTab === 3 && <AdminLogTab />}
    </div>
  );
}
