"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLang } from "@/lib/i18n/context";

type TabKey = "overview" | "account" | "profile" | "cv" | "ijazas" | "availability";

interface TabBarProps {
  teacherId: string;
}

export function TabBar({ teacherId }: TabBarProps) {
  return (
    <Suspense fallback={null}>
      <TabBarInner teacherId={teacherId} />
    </Suspense>
  );
}

function TabBarInner({ teacherId }: TabBarProps) {
  const { t } = useLang();
  const sp = useSearchParams();
  const active = (sp.get("tab") as TabKey | null) ?? "overview";

  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: t("نظرة عامة", "Overview") },
    { key: "account", label: t("الحساب", "Account") },
    { key: "profile", label: t("بيانات المعلم", "Teacher profile") },
    { key: "cv", label: t("السيرة الذاتية", "CV") },
    { key: "ijazas", label: t("الإجازات", "Ijazas") },
    { key: "availability", label: t("التوفر", "Availability") },
  ];

  return (
    <div className="mb-6 flex flex-wrap gap-2 border-b border-white/10 pb-1">
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        const href =
          tab.key === "overview"
            ? `/admin/teachers/${teacherId}`
            : `/admin/teachers/${teacherId}?tab=${tab.key}`;
        return (
          <Link
            key={tab.key}
            href={href}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-gold/10 text-gold border-b-2 border-gold"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
