import Link from "next/link";
import { Search, Calendar, MessageSquare } from "lucide-react";

export function QuickActions() {
  return (
    <div className="mt-6 grid grid-cols-3 gap-3">
      <Link
        href="/student/teachers"
        className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40"
      >
        <Search size={18} className="shrink-0 text-gold" />
        <span className="text-sm font-medium">تصفح المعلمين</span>
      </Link>
      <Link
        href="/student/bookings"
        className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40"
      >
        <Calendar size={18} className="shrink-0 text-gold" />
        <span className="text-sm font-medium">حجوزاتي</span>
      </Link>
      <Link
        href="/student/messages"
        className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40"
      >
        <MessageSquare size={18} className="shrink-0 text-gold" />
        <span className="text-sm font-medium">الرسائل</span>
      </Link>
    </div>
  );
}
