"use client";

import { useState, useTransition } from "react";
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
  const [enabled, setEnabled] = useState(initialValue);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const newValue = !enabled;
    setEnabled(newValue);
    startTransition(async () => {
      const result = await updateSetting(settingKey, String(newValue));
      if (result.error) {
        setEnabled(!newValue); // revert on error
      }
    });
  }

  return (
    <div className="flex items-center justify-between glass-card rounded-xl px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{description}</p>
      </div>
      <button
        onClick={toggle}
        disabled={isPending}
        className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-gold" : "bg-muted/30"
        }`}
        aria-label={`${label}: ${enabled ? "مفعل" : "معطل"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            enabled ? "right-0.5" : "right-[22px]"
          }`}
        />
      </button>
    </div>
  );
}
