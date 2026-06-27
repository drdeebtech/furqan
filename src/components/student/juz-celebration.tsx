"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchNotifications } from "@/lib/actions/notifications";
import { isJuzCelebrated, markJuzCelebrated, extractJuzNumber } from "@/lib/realtime/juz-dedup";
import { logError } from "@/lib/logger";

/**
 * Full-screen RTL Arabic celebration modal for juz completion.
 *
 * Detects juz-completion notifications via the "furqan:notification:new"
 * event dispatched by RealtimeProvider. Re-fetches the latest notifications
 * from the RLS-guarded server action (poke → fetch, never trusts socket data).
 * De-dupes per juz in sessionStorage so a reconnect/replay can't re-fire.
 *
 * Quran teacher lens: only the server-computed juz NUMBER is rendered.
 * No ayah text is generated or displayed client-side.
 */
export function JuzCelebration() {
  const [celebrationJuz, setCelebrationJuz] = useState<number | null>(null);

  const checkForJuzCompletion = useCallback(async () => {
    try {
      const result = await fetchNotifications(5);
      if (!result.notifications) return;

      for (const notification of result.notifications) {
        if (notification.type !== "system") continue;
        const juz = extractJuzNumber(notification.data);
        if (juz === null) continue;
        if (isJuzCelebrated(juz)) continue;
        // New juz completion not yet shown this session
        markJuzCelebrated(juz);
        setCelebrationJuz(juz);
        return; // show one at a time
      }
    } catch (err) {
      logError("juz celebration check failed", err, { tag: "realtime" });
    }
  }, []);

  useEffect(() => {
    function handleNotification() {
      void checkForJuzCompletion();
    }
    document.addEventListener("furqan:notification:new", handleNotification);
    return () => document.removeEventListener("furqan:notification:new", handleNotification);
  }, [checkForJuzCompletion]);

  if (celebrationJuz === null) return null;

  // Convert to Eastern Arabic numerals for Arabic locale presentation
  const juzAr = celebrationJuz.toLocaleString("ar-SA");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`مبارك بإتمام الجزء ${juzAr}`}
      dir="rtl"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => setCelebrationJuz(null)}
    >
      {/* Modal card — stop click propagation so inner clicks don't close */}
      <div
        className="relative mx-4 w-full max-w-sm rounded-3xl border border-gold/30 bg-[var(--surface)] p-8 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Decorative star */}
        <div className="mb-4 text-5xl" aria-hidden="true">
          ✨
        </div>

        {/* Congratulation heading */}
        <h2 className="mb-2 font-display text-2xl font-bold text-gold">
          مبارك!
        </h2>

        {/* Juz number — server-computed, never model-generated */}
        <p className="mb-1 text-lg font-semibold">
          أتممتَ الجزء
        </p>
        <p
          className="mb-4 font-display text-6xl font-bold text-gold"
          aria-label={`الجزء ${juzAr}`}
        >
          {juzAr}
        </p>

        <p className="mb-6 text-sm text-muted">
          تم إصدار شهادة إتمام الجزء لك — بارك الله في حفظك.
        </p>

        <button
          type="button"
          onClick={() => setCelebrationJuz(null)}
          className="w-full rounded-xl bg-gold px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-gold-hover focus-ring"
          autoFocus
        >
          شكراً
        </button>
      </div>
    </div>
  );
}
