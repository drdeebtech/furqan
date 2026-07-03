"use client";

import { useEffect, useState } from "react";
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

  // Price inputs are debounced like the search box: typing "25" must not fire
  // two URL replacements + two fetches. Local raw state absorbs keystrokes;
  // onChange fires 300ms after the last one. handleClear resets the raw state
  // explicitly (a prop sync-back effect would trip the set-state-in-effect
  // lint and can clobber in-flight typing).
  // ponytail: raw state seeds from the URL at mount only — browser
  // back/forward won't re-sync these two fields; wire a key-reset if that
  // ever matters.
  const [priceMinRaw, setPriceMinRaw] = useState(filters.priceMin);
  const [priceMaxRaw, setPriceMaxRaw] = useState(filters.priceMax);
  const handleClear = () => {
    setPriceMinRaw("");
    setPriceMaxRaw("");
    onClear();
  };
  useEffect(() => {
    const id = setTimeout(() => onChange("priceMin", priceMinRaw), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceMinRaw]);
  useEffect(() => {
    const id = setTimeout(() => onChange("priceMax", priceMaxRaw), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceMaxRaw]);

  // Rendered twice (mobile + desktop are both in the DOM), so every control id
  // is prefixed per instance to keep htmlFor/id pairs valid and unique.
  const renderPanel = (idPrefix: string) => (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-filter-language`} className="mb-1 block text-xs font-medium text-muted-light">
          {t("اللغة", "Language")}
        </label>
        <select
          id={`${idPrefix}-filter-language`}
          value={filters.language}
          onChange={(e) => onChange("language", e.target.value)}
          className="min-h-11 w-full rounded-lg border border-white/10 bg-card/50 px-3 py-2 text-sm text-foreground focus:border-gold/40 focus:outline-none"
        >
          <option value="">{t("كل اللغات", "All languages")}</option>
          {TEACHER_LANGUAGES.map((l) => (
            <option key={l.key} value={l.key}>{t(l.ar, l.en)}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-filter-gender`} className="mb-1 block text-xs font-medium text-muted-light">
          {t("الجنس", "Gender")}
        </label>
        <select
          id={`${idPrefix}-filter-gender`}
          value={filters.gender}
          onChange={(e) => onChange("gender", e.target.value)}
          className="min-h-11 w-full rounded-lg border border-white/10 bg-card/50 px-3 py-2 text-sm text-foreground focus:border-gold/40 focus:outline-none"
        >
          <option value="">{t("الكل", "All")}</option>
          <option value="male">{t("معلم", "Male teacher")}</option>
          <option value="female">{t("معلمة", "Female teacher")}</option>
        </select>
      </div>

      {Object.keys(specialtyLabels).length > 0 && (
        <div>
          <label htmlFor={`${idPrefix}-filter-specialty`} className="mb-1 block text-xs font-medium text-muted-light">
            {t("التخصص", "Specialty")}
          </label>
          <select
            id={`${idPrefix}-filter-specialty`}
            value={filters.specialty}
            onChange={(e) => onChange("specialty", e.target.value)}
            className="min-h-11 w-full rounded-lg border border-white/10 bg-card/50 px-3 py-2 text-sm text-foreground focus:border-gold/40 focus:outline-none"
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
          <span className="mb-1 block text-xs font-medium text-muted-light">
            {t("السعر $/ساعة", "Price $/hr")}
          </span>
          <div className="flex gap-2">
            <div className="w-1/2">
              <label htmlFor={`${idPrefix}-filter-price-min`} className="sr-only">
                {t("الحد الأدنى للسعر", "Minimum price")}
              </label>
              <input
                id={`${idPrefix}-filter-price-min`}
                type="number"
                value={priceMinRaw}
                onChange={(e) => setPriceMinRaw(e.target.value)}
                placeholder={t("من", "Min")}
                min={0}
                className="min-h-11 w-full rounded-lg border border-white/10 bg-card/50 px-3 py-2 text-sm text-foreground focus:border-gold/40 focus:outline-none"
              />
            </div>
            <div className="w-1/2">
              <label htmlFor={`${idPrefix}-filter-price-max`} className="sr-only">
                {t("الحد الأقصى للسعر", "Maximum price")}
              </label>
              <input
                id={`${idPrefix}-filter-price-max`}
                type="number"
                value={priceMaxRaw}
                onChange={(e) => setPriceMaxRaw(e.target.value)}
                placeholder={t("إلى", "Max")}
                min={0}
                className="min-h-11 w-full rounded-lg border border-white/10 bg-card/50 px-3 py-2 text-sm text-foreground focus:border-gold/40 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {activeCount > 0 && (
        <button
          type="button"
          onClick={handleClear}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-sm text-muted transition-colors hover:text-foreground"
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
          className="flex min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-card/30 px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
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
            {renderPanel("m")}
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
          {renderPanel("d")}
        </div>
      </aside>
    </>
  );
}
