"use client";

import { useState, useEffect, useCallback } from "react";
import { Download, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallPrompt() {
  const { t } = useLang();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window !== "undefined") return !!sessionStorage.getItem("pwa-dismissed");
    return false;
  });

  const handleBeforeInstall = useCallback((e: Event) => {
    e.preventDefault();
    setDeferredPrompt(e as BeforeInstallPromptEvent);
  }, []);

  useEffect(() => {
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
    }
  }

  function handleDismiss() {
    setDismissed(true);
    setDeferredPrompt(null);
    sessionStorage.setItem("pwa-dismissed", "1");
  }

  // Don't show if no prompt available, already installed, or dismissed
  if (!deferredPrompt || dismissed) return null;

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
