"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { X, UserPlus, BookOpen } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

export function WelcomePopup() {
  const { t } = useLang();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem("furqan-welcome-seen");
    if (!seen) {
      const timer = setTimeout(() => setShow(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  function dismiss() {
    setShow(false);
    localStorage.setItem("furqan-welcome-seen", "1");
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={dismiss}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-4 w-full max-w-md animate-in rounded-2xl border border-gold/30 bg-card p-8 shadow-2xl shadow-gold/10"
      >
        <button onClick={dismiss} className="absolute left-4 top-4 text-muted hover:text-foreground">
          <X size={20} />
        </button>

        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-gold/30 bg-gold/10">
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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold py-3.5 text-lg font-bold text-background transition-colors hover:bg-gold-hover"
            >
              <UserPlus size={20} />
              {t("سجّل الآن مجاناً", "Register Now — Free")}
            </Link>
            <button
              onClick={dismiss}
              className="w-full rounded-xl border border-card-border py-3 text-sm text-muted transition-colors hover:border-gold/40 hover:text-gold"
            >
              {t("تصفح الموقع أولاً", "Browse the site first")}
            </button>
          </div>

          <p className="mt-4 text-xs text-muted">
            {t("التسجيل مجاني · معلمون معتمدون · جلسات فيديو مباشرة", "Free registration · Certified teachers · Live video sessions")}
          </p>
        </div>
      </div>
    </div>
  );
}
