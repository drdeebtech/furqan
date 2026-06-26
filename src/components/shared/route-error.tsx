"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, ArrowLeft, Home, RefreshCw } from "lucide-react";
import { logError } from "@/lib/logger";
import { useLang } from "@/lib/i18n/context";

/**
 * Localized route error boundary UI. Each segment's `error.tsx` is a thin
 * wrapper around this component, passing a `route` tag (for Sentry) and a
 * `homeHref` (where the "go home" link points). Copy switches between Arabic
 * and English via `useLang()`, and `dir` follows the locale so the layout is
 * RTL/LTR-correct. (Issue #557.)
 *
 * Kept as a single shared component because the four segment error boundaries
 * (public/student/teacher/admin) were byte-for-byte identical apart from one
 * heading string + the home link — localizing each separately would have
 * quadrupled the bilingual strings.
 */
export function RouteErrorBoundary({
  error,
  reset,
  route,
  homeHref,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  route: "public" | "student" | "teacher" | "admin";
  homeHref: string;
}) {
  const { lang } = useLang();
  const ar = lang === "ar";

  useEffect(() => {
    logError(`${route} route boundary caught an error`, error, {
      tag: "ui-error",
      digest: error.digest,
      route,
      severity: route === "admin" ? "critical" : "error",
    });
  }, [error, route]);

  const copy = {
    title: ar ? "عذراً، حدث خطأ" : "Something went wrong",
    body: ar
      ? "تعذر تحميل هذه الصفحة. نسجّل الخطأ تلقائياً ليتمكن الفريق من معالجته."
      : "We couldn't load this page. The error has been logged and our team will look into it.",
    retry: ar ? "حاول مرة أخرى" : "Try again",
    home: ar ? "العودة للرئيسية" : "Go home",
    digestLabel: ar ? "رقم الخطأ" : "Error ID",
  } as const;

  return (
    <div
      dir={ar ? "rtl" : "ltr"}
      className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16"
    >
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-error/10">
        <AlertTriangle size={28} className="text-error" aria-hidden="true" />
      </div>

      <h1 className="mt-5 text-center font-display text-2xl font-bold text-foreground sm:text-3xl">
        {copy.title}
      </h1>
      <p className="mt-2 max-w-md text-center text-sm leading-relaxed text-muted">
        {copy.body}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="glass-gold glass-pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-gold-hover focus-ring"
        >
          <RefreshCw size={14} aria-hidden="true" />
          {copy.retry}
        </button>
        <Link
          href={homeHref}
          className="glass glass-pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gold transition-colors hover:bg-gold/10 focus-ring"
        >
          <Home size={14} aria-hidden="true" />
          {copy.home}
          <ArrowLeft size={12} aria-hidden="true" />
        </Link>
      </div>

      {error.digest && (
        <p className="mt-10 text-xs text-muted-light">
          {copy.digestLabel}:{" "}
          <code dir="ltr" className="rounded bg-[var(--surface-light)] px-1.5 py-0.5 font-mono text-[11px]">
            {error.digest}
          </code>
        </p>
      )}
    </div>
  );
}
