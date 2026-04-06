"use client";

import { useLang } from "@/lib/i18n/context";

const STEPS = [
  { ar: "اختيار المعلم", en: "Choose Teacher" },
  { ar: "تفاصيل الحجز", en: "Booking Details" },
  { ar: "تأكيد", en: "Confirm" },
];

export function BookingSteps({ current }: { current: 1 | 2 | 3 }) {
  const { t } = useLang();

  return (
    <div className="mb-6 flex items-center justify-center gap-1 text-xs sm:gap-2 sm:text-sm">
      {STEPS.map((step, i) => {
        const num = i + 1;
        const isActive = num === current;
        const isDone = num < current;
        return (
          <div key={step.en} className="flex items-center gap-1 sm:gap-2">
            {i > 0 && <span className={`hidden transition-colors sm:inline ${isDone || isActive ? "text-gold" : "text-muted/30"}`}>←</span>}
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
              isActive ? "bg-gold/20 font-bold text-gold" :
              isDone ? "bg-success/10 text-success" :
              "text-muted/50"
            }`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                isActive ? "bg-gold text-background" :
                isDone ? "bg-success text-background" :
                "bg-card-border text-muted"
              }`}>
                {isDone ? "✓" : num}
              </span>
              <span className="hidden sm:inline">{t(step.ar, step.en)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
