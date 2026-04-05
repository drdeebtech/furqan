import Link from "next/link";
import { Search, CalendarPlus, Video } from "lucide-react";

export function GuidanceBanner() {
  return (
    <div className="mt-6 rounded-2xl border border-gold/30 bg-gold/5 p-6">
      <h2 className="text-lg font-bold text-gold">ابدأ رحلتك مع القرآن</h2>
      <p className="mt-1 text-sm text-muted">اتبع هذه الخطوات البسيطة للبدء</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold">١</div>
          <div>
            <p className="text-sm font-medium">تصفح المعلمين</p>
            <p className="text-xs text-muted">اختر معلمك المناسب</p>
          </div>
          <Search size={16} className="mr-auto text-gold" />
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold">٢</div>
          <div>
            <p className="text-sm font-medium">احجز جلسة</p>
            <p className="text-xs text-muted">اختر الوقت المناسب</p>
          </div>
          <CalendarPlus size={16} className="mr-auto text-gold" />
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold">٣</div>
          <div>
            <p className="text-sm font-medium">انضم للجلسة</p>
            <p className="text-xs text-muted">تعلّم مع معلمك مباشرة</p>
          </div>
          <Video size={16} className="mr-auto text-gold" />
        </div>
      </div>
      <Link
        href="/student/teachers"
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-gold-hover"
      >
        <Search size={16} />
        ابدأ الآن
      </Link>
    </div>
  );
}
