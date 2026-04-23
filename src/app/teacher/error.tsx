"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function TeacherError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div dir="rtl" className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16">
      <AlertTriangle size={56} className="mb-6 text-red-400" />
      <h1 className="mb-3 text-2xl font-bold text-foreground">حدث خطأ في صفحة المعلم</h1>
      <p className="mb-8 max-w-md text-center text-muted">
        تعذر تحميل هذه الصفحة. جرّب إعادة التحميل أو ارجع للوحتك.
      </p>
      <div className="flex flex-wrap gap-4">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-hover"
        >
          حاول مرة أخرى
        </button>
        <Link
          href="/teacher/dashboard"
          className="rounded-lg border border-surface-border px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface"
        >
          العودة للوحة المعلم
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
