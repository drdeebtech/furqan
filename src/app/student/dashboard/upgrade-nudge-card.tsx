"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpCircle, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

const DISMISS_KEY_PREFIX = "upgrade-nudge-dismissed:";

/** Minimal sessionStorage surface — typed so the reader is DOM-independent. */
type SessionStorageLike = {
  getItem: (key: string) => string | null;
};

/**
 * Storage key for a given package's dismissal. Null when there is no active
 * package (no package → no key → reader returns false).
 */
export function dismissalKeyForPackage(packageId: string | null): string | null {
  return packageId ? `${DISMISS_KEY_PREFIX}${packageId}` : null;
}

/**
 * Pure reader for the dismissal flag. Extracted so the dismissal-key logic is
 * unit-testable without a DOM (this repo's vitest config runs in the `node`
 * environment, not jsdom — see vitest.config.ts; there is no
 * @testing-library/react setup). Returns true ONLY when the stored flag for
 * THIS package is exactly "1", so switching to a different package (different
 * key with no stored value) correctly resets the nudge to visible.
 */
export function readUpgradeNudgeDismissed(
  storage: SessionStorageLike | null,
  packageId: string | null,
): boolean {
  const key = dismissalKeyForPackage(packageId);
  if (!key || !storage) return false;
  try {
    return storage.getItem(key) === "1";
  } catch {
    // private mode / disabled storage — treat as not-dismissed
    return false;
  }
}

/** Event dispatched after a dismissal so the nudge re-reads sessionStorage. */
const DISMISS_EVENT = "upgrade-nudge:dismissed";

/**
 * useSyncExternalStore subscriber. Dismissal only changes via this component's
 * own handleDismiss (which dispatches DISMISS_EVENT after writing
 * sessionStorage), so listening for that event is sufficient. No-op on the
 * server keeps SSR inert.
 */
function subscribeDismissal(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DISMISS_EVENT, onChange);
  return () => window.removeEventListener(DISMISS_EVENT, onChange);
}

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

  // Read the dismissal flag reactively from sessionStorage via
  // useSyncExternalStore: hydration-safe (server snapshot = not dismissed) and
  // free of setState-in-effect (which the React lint rule flags as a cascading
  // render). The client snapshot reads THIS package's key, so switching to a
  // different package naturally re-enables the nudge (issue #546). handleDismiss
  // writes the key and dispatches DISMISS_EVENT to trigger a re-read.
  const dismissed = useSyncExternalStore(
    subscribeDismissal,
    () => readUpgradeNudgeDismissed(window.sessionStorage, packageId),
    () => false,
  );

  // Gate on exactly 1 credit (per the issue).
  if (remainingCredits !== 1) return null;
  if (dismissed) return null;

  function handleDismiss() {
    const storageKey = dismissalKeyForPackage(packageId);
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(storageKey, "1");
      window.dispatchEvent(new Event(DISMISS_EVENT));
    } catch {
      // private mode — dismissal only lasts for this render tree
    }
  }

  return (
    <section
      dir={dir}
      aria-label={t("ترقية باقتك", "Upgrade your package")}
      className="rounded-2xl border border-card-border bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ArrowUpCircle
            size={20}
            className="mt-0.5 shrink-0 text-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
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
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring"
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
