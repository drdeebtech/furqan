import Link from "next/link";
import { FileText, Calendar, Clock, CheckCircle, AlertCircle } from "lucide-react";

type CvStatus = "draft" | "pending_review" | "approved" | "rejected";

export function TeacherGuidanceBanner({
  cvStatus,
  hasStudents,
}: {
  cvStatus: CvStatus;
  hasStudents: boolean;
}) {
  // CV not approved — show gate
  if (cvStatus !== "approved") {
    const statusMsg: Record<string, { text: string; color: string }> = {
      draft: { text: "سيرتك الذاتية غير مكتملة", color: "text-amber-400" },
      pending_review: { text: "سيرتك الذاتية قيد المراجعة", color: "text-blue-400" },
      rejected: { text: "سيرتك الذاتية مرفوضة — يرجى التعديل وإعادة الإرسال", color: "text-error" },
    };
    const s = statusMsg[cvStatus] ?? statusMsg.draft;

    return (
      <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className={`mt-0.5 shrink-0 ${s.color}`} />
          <div>
            <p className={`font-bold ${s.color}`}>{s.text}</p>
            <p className="mt-1 text-sm text-muted">أكمل سيرتك الذاتية لبدء استقبال الطلاب</p>
            {cvStatus !== "pending_review" && (
              <Link
                href="/teacher/cv"
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gold px-5 py-2 text-sm font-semibold text-background transition-colors hover:bg-gold-hover"
              >
                <FileText size={16} />
                أكمل السيرة الذاتية
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Approved but no students yet — show onboarding
  if (!hasStudents) {
    return (
      <div className="mt-6 rounded-2xl border border-gold/30 bg-gold/5 p-6">
        <h2 className="text-lg font-bold text-gold">ابدأ التدريس</h2>
        <p className="mt-1 text-sm text-muted">اتبع هذه الخطوات لاستقبال طلابك</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold">١</div>
            <div>
              <p className="text-sm font-medium">أضف مواعيدك</p>
              <p className="text-xs text-muted">حدد أوقات إتاحتك</p>
            </div>
            <Calendar size={16} className="mr-auto text-gold" />
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold">٢</div>
            <div>
              <p className="text-sm font-medium">انتظر حجزاً</p>
              <p className="text-xs text-muted">سيحجز الطلاب معك</p>
            </div>
            <Clock size={16} className="mr-auto text-gold" />
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold">٣</div>
            <div>
              <p className="text-sm font-medium">أكّد وابدأ</p>
              <p className="text-xs text-muted">أكّد الحجز وابدأ التدريس</p>
            </div>
            <CheckCircle size={16} className="mr-auto text-gold" />
          </div>
        </div>
        <Link
          href="/teacher/availability"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-gold-hover"
        >
          <Calendar size={16} />
          أضف مواعيدك
        </Link>
      </div>
    );
  }

  return null;
}
