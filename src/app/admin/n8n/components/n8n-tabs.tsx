"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { OverviewTab } from "./overview-tab";
import { HealthAuditTab } from "./health-audit-tab";
import { ExecutionIntelTab } from "./execution-intel-tab";
import { AdminLogTab } from "./admin-log-tab";

const tabs = [
  { ar: "نظرة عامة", en: "Overview" },
  { ar: "فحص الصحة", en: "Health Audit" },
  { ar: "الذكاء التشغيلي", en: "Execution Intel" },
  { ar: "سجل الإدارة", en: "Admin Log" },
] as const;

export function N8nTabs() {
  const { t } = useLang();
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div dir="rtl" className="mx-auto max-w-6xl px-4 py-8">
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

      {/* Tab content — lazy render: only mount active tab */}
      {activeTab === 0 && <OverviewTab />}
      {activeTab === 1 && <HealthAuditTab />}
      {activeTab === 2 && <ExecutionIntelTab />}
      {activeTab === 3 && <AdminLogTab />}
    </div>
  );
}
