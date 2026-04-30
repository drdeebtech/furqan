import Link from "next/link";
import { Home, ArrowLeft } from "lucide-react";

export default function AdminNotFound() {
  return (
    <div dir="rtl" className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16 text-center">
      <p className="font-display text-6xl font-bold text-gold sm:text-7xl" aria-hidden="true">
        ٤٠٤
      </p>
      <h1 className="mt-4 font-display text-2xl font-bold text-foreground">
        صفحة الإدارة غير موجودة
      </h1>
      <p className="mt-2 text-sm text-muted">
        Admin page not found
      </p>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
        تأكد من الرابط أو عُد للوحة الإدارة.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/admin/dashboard"
          className="glass-gold glass-pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover focus-ring"
        >
          <Home size={14} aria-hidden="true" />
          لوحة الإدارة
          <ArrowLeft size={12} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
