"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { logError } from "@/lib/logger";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError("Admin route boundary caught an error", error, {
      tag: "ui-error",
      digest: error.digest,
      route: "admin",
      severity: "critical",
    });
  }, [error]);

  return (
    <div dir="rtl" className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16">
      <AlertTriangle size={56} className="mb-6 text-red-500" aria-hidden="true" />
      <h1 className="mb-3 text-2xl font-bold text-foreground">حدث خطأ في لوحة الإدارة</h1>
      <p className="mb-8 max-w-md text-center text-muted">
        تعذر تحميل هذه الصفحة. جرّب إعادة التحميل أو ارجع للوحة الرئيسية.
      </p>
      <div className="flex flex-wrap gap-4">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-hover"
        >
          حاول مرة أخرى
        </button>
        <Link
          href="/admin/dashboard"
          className="rounded-lg border border-surface-border px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface"
        >
          العودة للوحة الإدارة
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
