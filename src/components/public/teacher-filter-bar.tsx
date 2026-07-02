"use client";

import { useState } from "react";
import { Filter, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useFeatureFlags } from "@/lib/feature-flags-context";
import { TEACHER_LANGUAGES } from "@/lib/constants";

type LabelMap = Record<string, { ar: string; en: string }>;

export interface FilterState {
  language: string;
  gender: string;
  specialty: string;
  priceMin: string;
  priceMax: string;
}

interface Props {
  filters: FilterState;
  specialtyLabels: LabelMap;
  onChange: (key: keyof FilterState, value: string) => void;
  onClear: () => void;
}

export function TeacherFilterBar({ filters, specialtyLabels, onChange, onClear }: Props) {
  const { t } = useLang();
  const { hidePrices } = useFeatureFlags();
  const [isOpen, setIsOpen] = useState(false);

  const activeCount = Object.values(filters).filter(Boolean).length;

  const panel = (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-light">
          {t("اللغة", "Language")}
        </label>
        <select
          value={filters.language}
          onChange={(e) => onChange("language", e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-card/50 px-3 py-2 text-sm text-foreground focus:border-gold/40 focus:outline-none"
          aria-label={t("تصفية حسب اللغة", "Filter by language")}
        >
          <option value="">{t("كل اللغات", "All languages")}</option>
          {TEACHER_LANGUAGES.map((l) => (
            <option key={l.key} value={l.key}>{t(l.ar, l.en)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-light">
          {t("الجنس", "Gender")}
        </label>
        <select
          value={filters.gender}
          onChange={(e) => onChange("gender", e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-card/50 px-3 py-2 text-sm text-foreground focus:border-gold/40 focus:outline-none"
          aria-label={t("تصفية حسب الجنس", "Filter by gender")}
        >
          <option value="">{t("الكل", "All")}</option>
          <option value="male">{t("معلم", "Male teacher")}</option>
          <option value="female">{t("معلمة", "Female teacher")}</option>
        </select>
      </div>

      {Object.keys(specialtyLabels).length > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-light">
            {t("التخصص", "Specialty")}
          </label>
          <select
            value={filters.specialty}
            onChange={(e) => onChange("specialty", e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-card/50 px-3 py-2 text-sm text-foreground focus:border-gold/40 focus:outline-none"
            aria-label={t("تصفية حسب التخصص", "Filter by specialty")}
          >
            <option value="">{t("كل التخصصات", "All specialties")}</option>
            {Object.entries(specialtyLabels).map(([key, label]) => (
              <option key={key} value={key}>{t(label.ar, label.en)}</option>
            ))}
          </select>
        </div>
      )}

      {!hidePrices && (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-light">
            {t("السعر $/ساعة", "Price $/hr")}
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={filters.priceMin}
              onChange={(e) => onChange("priceMin", e.target.value)}
              placeholder={t("من", "Min")}
              min={0}
              className="w-1/2 rounded-lg border border-white/10 bg-card/50 px-3 py-2 text-sm text-foreground focus:border-gold/40 focus:outline-none"
              aria-label={t("الحد الأدنى للسعر", "Minimum price")}
            />
            <input
              type="number"
              value={filters.priceMax}
              onChange={(e) => onChange("priceMax", e.target.value)}
              placeholder={t("إلى", "Max")}
              min={0}
              className="w-1/2 rounded-lg border border-white/10 bg-card/50 px-3 py-2 text-sm text-foreground focus:border-gold/40 focus:outline-none"
              aria-label={t("الحد الأقصى للسعر", "Maximum price")}
            />
          </div>
        </div>
      )}

      {activeCount > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-sm text-muted transition-colors hover:text-foreground"
        >
          <X size={14} aria-hidden="true" />
          {t("مسح التصفية", "Clear filters")}
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile — collapsible */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-card/30 px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
          aria-expanded={isOpen}
          aria-controls="teacher-filter-panel"
        >
          <Filter size={14} aria-hidden="true" />
          {t("التصفية", "Filters")}
          {activeCount > 0 && (
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[10px] font-bold text-background">
              {activeCount}
            </span>
          )}
        </button>
        {isOpen && (
          <div id="teacher-filter-panel" className="mt-3 rounded-xl border border-white/10 bg-card/50 p-4">
            {panel}
          </div>
        )}
      </div>

      {/* Desktop — sidebar */}
      <aside
        className="hidden w-56 shrink-0 lg:block"
        aria-label={t("لوحة التصفية", "Filter panel")}
      >
        <div className="sticky top-24 rounded-xl border border-white/10 bg-card/50 p-4">
          <p className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-light">
            {t("التصفية", "Filters")}
          </p>
          {panel}
        </div>
      </aside>
    </>
  );
}
