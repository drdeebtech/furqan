"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, ArrowLeft, Home, RefreshCw } from "lucide-react";
import { logError } from "@/lib/logger";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError("Public route boundary caught an error", error, {
      tag: "ui-error",
      digest: error.digest,
      route: "(public)",
    });
  }, [error]);

  return (
    <div
      dir="rtl"
      className="relative flex min-h-[80vh] flex-col items-center justify-center px-4 py-16"
    >
      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-error/10">
          <AlertTriangle size={28} className="text-error" aria-hidden="true" />
        </div>

        <h1 className="mt-5 font-display text-2xl font-bold text-foreground sm:text-3xl">
          عذراً، حدث خطأ
        </h1>
        <p className="mt-1 text-sm text-muted">
          Something went wrong while loading this page
        </p>

        <p className="mt-6 max-w-md text-sm leading-relaxed text-muted">
          نسجّل الخطأ تلقائياً ليتمكن الفريق من معالجته. يمكنك المحاولة مرة أخرى أو العودة إلى الصفحة الرئيسية.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="glass-gold glass-pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-gold-hover focus-ring"
          >
            <RefreshCw size={14} aria-hidden="true" />
            حاول مرة أخرى
            <span dir="ltr" className="text-xs opacity-70">· Try again</span>
          </button>
          <Link
            href="/"
            className="glass glass-pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gold transition-colors hover:bg-gold/10 focus-ring"
          >
            <Home size={14} aria-hidden="true" />
            العودة للرئيسية
            <ArrowLeft size={12} aria-hidden="true" />
          </Link>
        </div>

        {error.digest && (
          <p className="mt-10 text-xs text-muted-light">
            رقم الخطأ:{" "}
            <code dir="ltr" className="rounded bg-[var(--surface-light)] px-1.5 py-0.5 font-mono text-[11px]">
              {error.digest}
            </code>
          </p>
        )}
      </div>
    </div>
  );
}
