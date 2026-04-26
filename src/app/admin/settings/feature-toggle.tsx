"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLang } from "@/lib/i18n/context";
import { updateSetting } from "./actions";

export function FeatureToggle({
  settingKey,
  label,
  description,
  initialValue,
}: {
  settingKey: string;
  label: string;
  description: string;
  initialValue: boolean;
}) {
  const { t } = useLang();
  const [enabled, setEnabled] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function toggle() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setError(null);
    const newValue = !enabled;
    setEnabled(newValue);
    startTransition(async () => {
      const result = await updateSetting(settingKey, String(newValue));
      if (result.error) {
        setEnabled(!newValue);
        setError(
          result.error || t("فشل الحفظ — حاول مجدداً", "Save failed — try again"),
        );
        timerRef.current = setTimeout(() => {
          setError(null);
          timerRef.current = null;
        }, 4000);
      }
    });
  }

  return (
    <div className="flex items-center justify-between glass-card rounded-xl px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{description}</p>
        {error && (
          <p className="mt-1 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
      <button
        onClick={toggle}
        disabled={isPending}
        className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-gold" : "bg-muted/30"
        }`}
        aria-label={`${label}: ${enabled ? t("مفعل", "Enabled") : t("معطل", "Disabled")}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            enabled ? "end-0.5" : "end-[22px]"
          }`}
        />
      </button>
    </div>
  );
}
