import Link from "next/link";

export default function NotFound() {
  return (
    <div
      dir="rtl"
      className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16"
    >
      <p className="mb-2 text-6xl font-bold text-gold">404</p>

      <h1 className="mb-3 text-2xl font-bold text-foreground">
        الصفحة غير موجودة
      </h1>

      <p className="mb-8 max-w-md text-center text-muted">
        عذرا، لم نتمكن من العثور على الصفحة المطلوبة.
      </p>

      <Link
        href="/"
        className="rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-hover"
      >
        العودة للرئيسية
      </Link>
    </div>
  );
}
