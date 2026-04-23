"use client";

import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      dir="rtl"
      className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16"
    >
      {/* Error icon */}
      <svg
        width="56"
        height="56"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mb-6 text-error"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>

      <h1 className="mb-3 text-2xl font-bold text-foreground">
        عذرا، حدث خطأ
      </h1>

      <p className="mb-8 max-w-md text-center text-muted">
        حدث خطأ أثناء تحميل الصفحة. يرجى المحاولة مرة أخرى.
      </p>

      <div className="flex gap-4">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-hover"
        >
          حاول مرة أخرى
        </button>

        <Link
          href="/"
          className="rounded-lg border border-surface-border px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface"
        >
          العودة للرئيسية
        </Link>
      </div>

      {error.digest && (
        <p className="mt-8 text-xs text-muted opacity-60">
          رقم الخطأ: <code dir="ltr" className="font-mono">{error.digest}</code>
        </p>
      )}
    </div>
  );
}
