"use client";

import { useState, useEffect, useCallback, useRef, startTransition } from "react";
import Link from "next/link";
import { X, UserPlus, BookOpen } from "lucide-react";
import { GlassButton } from "@/components/ui/GlassButton";
import { useLang } from "@/lib/i18n/context";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function WelcomePopup() {
  const { t } = useLang();
  const [show, setShow] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const seen = localStorage.getItem("furqan-welcome-seen");
    if (!seen) {
      const timer = setTimeout(() => startTransition(() => setShow(true)), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismiss = useCallback(() => {
    setShow(false);
    localStorage.setItem("furqan-welcome-seen", "1");
  }, []);

  // Focus trap: capture focus on open, cycle Tab, handle Escape, restore on close
  useEffect(() => {
    if (!show) return;

    // Save the element that was focused before the dialog opened
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    // Focus the first interactive element inside the dialog
    const dialog = dialogRef.current;
    if (dialog) {
      const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        dismiss();
        return;
      }

      if (e.key === "Tab" && dialog) {
        const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          // Shift+Tab: if on first element, wrap to last
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // Tab: if on last element, wrap to first
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the previously focused element
      previouslyFocusedRef.current?.focus();
    };
  }, [show, dismiss]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={dismiss}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("مرحباً بك في فُرقان", "Welcome to FURQAN")}
        onClick={(e) => e.stopPropagation()}
        className="relative mx-4 w-full max-w-md animate-in glass-modal p-8"
      >
        <button onClick={dismiss} aria-label={t("إغلاق", "Close")} className="focus-ring absolute start-4 top-4 text-muted hover:text-foreground">
          <X size={20} />
        </button>

        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center glass glass-pill animate-pulse-slow">
            <BookOpen size={28} className="text-gold" />
          </div>

          <h2 className="font-display text-2xl font-bold">
            {t("مرحباً بك في فُرقان", "Welcome to FURQAN")}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {t(
              "أكاديمية تعليم القرآن الكريم عبر الإنترنت مع معلمين حاصلين على الإجازة",
              "Online Quran Academy with certified teachers holding Ijazah",
            )}
          </p>

          <div className="mt-6 space-y-3">
            <Link
              href="/register"
              onClick={dismiss}
              className="focus-ring glass-gold glass-pill flex w-full items-center justify-center gap-2 py-3.5 text-lg font-bold transition-all duration-200"
            >
              <UserPlus size={20} />
              {t("سجّل الآن مجاناً", "Register Now — Free")}
            </Link>
            <GlassButton
              onClick={dismiss}
              variant="ghost"
              pill
              className="w-full py-3 text-sm text-muted transition-all duration-200 hover:text-gold"
            >
              {t("تصفح الموقع أولاً", "Browse the site first")}
            </GlassButton>
          </div>

          <p className="mt-4 text-xs text-muted">
            {t("التسجيل مجاني · معلمون معتمدون · جلسات فيديو مباشرة", "Free registration · Certified teachers · Live video sessions")}
          </p>
        </div>
      </div>
    </div>
  );
}
