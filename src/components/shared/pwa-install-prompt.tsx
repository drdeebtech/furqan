"use client";

import { useState, useEffect, useCallback, startTransition } from "react";
import { usePathname } from "next/navigation";
import { Download, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallPrompt() {
  const { t } = useLang();
  const pathname = usePathname();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  // Hydration-safe: server renders `false`, client reconciles from sessionStorage on mount.
  // Banner is gated by `deferredPrompt` (always null on SSR until beforeinstallprompt fires),
  // so this never causes a visible flicker even during the brief mismatch window.
  const [dismissed, setDismissed] = useState(false);

  const handleBeforeInstall = useCallback((e: Event) => {
    e.preventDefault();
    setDeferredPrompt(e as BeforeInstallPromptEvent);
  }, []);

  useEffect(() => {
    // Persist dismissal across browser restarts (localStorage), not just the
    // current tab session (sessionStorage). Reported in the 2026-05-04 visual
    // audit: the prompt re-appeared on every navigation/refresh because
    // sessionStorage scopes to a single tab; users on a fresh open of the
    // site saw it again even after dismissing it last visit.
    if (typeof window !== "undefined") {
      const dismissedPersistent = localStorage.getItem("pwa-dismissed");
      const dismissedSession = sessionStorage.getItem("pwa-dismissed");
      if (dismissedPersistent || dismissedSession) {
        startTransition(() => setDismissed(true));
        return;
      }
    }
    if (dismissed) return;
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, [handleBeforeInstall, dismissed]);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
      // If they accepted, they don't need the prompt again.
      try { localStorage.setItem("pwa-dismissed", "1"); } catch { /* private mode */ }
    }
  }

  function handleDismiss() {
    setDismissed(true);
    setDeferredPrompt(null);
    // Persist across tab/browser close so the prompt doesn't re-nag.
    // Wrap in try/catch — Safari Private Mode throws on localStorage writes.
    try { localStorage.setItem("pwa-dismissed", "1"); } catch { /* private mode */ }
    // Mirror to sessionStorage so legacy code paths still see the flag.
    try { sessionStorage.setItem("pwa-dismissed", "1"); } catch { /* private mode */ }
  }

  // Don't show if no prompt available, already installed, or dismissed.
  // Also suppress on /pricing so it doesn't compete with the purchase decision.
  if (!deferredPrompt || dismissed || pathname === "/pricing") return null;

  return (
    <div className="fixed bottom-4 start-4 end-4 z-50 mx-auto max-w-sm animate-in slide-in-from-bottom">
      <div className="glass-card flex items-center gap-3 border-gold/30 p-4 shadow-2xl">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/20" aria-hidden="true">
          <Download size={20} className="text-gold" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("ثبّت تطبيق فرقان", "Install FURQAN App")}</p>
          <p className="text-xs text-muted">{t("أسرع وأسهل للوصول", "Faster and easier access")}</p>
        </div>
        <button
          onClick={handleInstall}
          className="shrink-0 rounded-full bg-gold px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-gold-hover"
        >
          {t("تثبيت", "Install")}
        </button>
        <button
          onClick={handleDismiss}
          aria-label={t("إغلاق", "Dismiss")}
          className="shrink-0 rounded-full p-1 text-muted transition-colors hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
