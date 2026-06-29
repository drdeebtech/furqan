"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpCircle, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

/**
 * Issue #546 — Contextual upgrade nudge shown on the student dashboard when
 * the active package has EXACTLY 1 session credit remaining.
 *
 * Credit value is passed from already-loaded server data (activePackages[0]
 *sessions_total − sessions_used); no new data fetch is performed here.
 *
 * Eligibility for an immediate vs. scheduled upgrade is NOT computed client-
 * side: `canUpgradeImmediately()` requires `CurrentTierInfo` + `NewTierInfo`
 * (subscription id, stripe sub id, plan id, product_category, sessions/month)
 * which the dashboard does not load. Rather than add a new fetch, the card
 * links to /pricing where the real eligibility check runs server-side in the
 * upgrade-tier route. Copy is kept generic (no fabricated tier names/prices).
 *
 * Dismissal: sessionStorage keyed by the active package id — survives reloads
 * but resets per browser session, and naturally re-enables the nudge if the
 * student's package changes. Mirrors the pwa-install-prompt dismissal pattern
 * but uses sessionStorage (per-session) instead of localStorage.
 */
export function UpgradeNudgeCard({
  remainingCredits,
  packageId,
}: {
  remainingCredits: number;
  packageId: string | null;
}) {
  const { t, dir } = useLang();
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  const storageKey = packageId ? `upgrade-nudge-dismissed:${packageId}` : null;

  // Hydration-safe: server renders dismissed=false, client reconciles from
  // sessionStorage on mount (matches the pwa-install-prompt pattern).
  useEffect(() => {
    setMounted(true);
    if (storageKey && typeof window !== "undefined") {
      try {
        if (sessionStorage.getItem(storageKey) === "1") {
          setDismissed(true);
        }
      } catch {
        // private mode / disabled storage — leave dismissed=false
      }
    }
  }, [storageKey]);

  // Gate on exactly 1 credit (per the issue). Don't render on the server when
  // the dismissal state is unknown — wait for mount to avoid a flash.
  if (remainingCredits !== 1) return null;
  if (!mounted) return null;
  if (dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    if (storageKey) {
      try {
        sessionStorage.setItem(storageKey, "1");
      } catch {
        // private mode — dismissal only lasts for this render tree
      }
    }
  }

  return (
    <section
      dir={dir}
      aria-label={t("ترقية باقتك", "Upgrade your package")}
      className="rounded-2xl border border-gold/30 bg-gold/5 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ArrowUpCircle
            size={20}
            className="mt-0.5 shrink-0 text-gold"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gold">
              {t("باقية لديك جلسة واحدة فقط", "You have 1 session left")}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">
              {t(
                "طوّر باقتك لمزيد من الجلسات بسعر أفضل للجلسة الواحدة.",
                "Upgrade your package for more sessions at a better per-session rate.",
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("إغلاق", "Dismiss")}
          className="shrink-0 rounded-full p-1 text-muted transition-colors hover:text-foreground focus-ring"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-gold-hover focus-ring"
        >
          {t("ترقية الآن", "Upgrade now")}
        </Link>
      </div>
    </section>
  );
}

/**
 * Pure visibility predicate — extracted so the gate logic (exactly-1 credit +
 * not-dismissed) is unit-testable without a DOM.
 */
export function shouldShowUpgradeNudge(
  remainingCredits: number,
  dismissed: boolean,
): boolean {
  return remainingCredits === 1 && !dismissed;
}
