"use client";

import Link from "next/link";
import { FileText, Calendar, Clock, CheckCircle, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

type CvStatus = "draft" | "pending_review" | "approved" | "rejected";

export function TeacherGuidanceBanner({ cvStatus, hasStudents }: { cvStatus: CvStatus; hasStudents: boolean }) {
  const { t } = useLang();

  if (cvStatus !== "approved") {
    const statusMsg: Record<string, { ar: string; en: string; color: string }> = {
      draft: { ar: "سيرتك الذاتية غير مكتملة", en: "Your CV is incomplete", color: "text-amber-400" },
      pending_review: { ar: "سيرتك الذاتية قيد المراجعة", en: "Your CV is under review", color: "text-blue-400" },
      rejected: { ar: "سيرتك الذاتية مرفوضة — يرجى التعديل وإعادة الإرسال", en: "Your CV was rejected — please revise and resubmit", color: "text-error" },
    };
    const s = statusMsg[cvStatus] ?? statusMsg.draft;

    return (
      <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className={`mt-0.5 shrink-0 ${s.color}`} />
          <div>
            <p className={`font-bold ${s.color}`}>{t(s.ar, s.en)}</p>
            <p className="mt-1 text-sm text-muted">{t("أكمل سيرتك الذاتية لبدء استقبال الطلاب", "Complete your CV to start receiving students")}</p>
            {cvStatus !== "pending_review" && (
              <Link href="/teacher/cv" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gold px-5 py-2 text-sm font-semibold text-background transition-colors hover:bg-gold-hover">
                <FileText size={16} />
                {t("أكمل السيرة الذاتية", "Complete CV")}
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!hasStudents) {
    return (
      <div className="mt-6 rounded-2xl border border-gold/30 bg-gold/5 p-6">
        <h2 className="text-lg font-bold text-gold">{t("ابدأ التدريس", "Start Teaching")}</h2>
        <p className="mt-1 text-sm text-muted">{t("اتبع هذه الخطوات لاستقبال طلابك", "Follow these steps to receive students")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold">١</div>
            <div>
              <p className="text-sm font-medium">{t("أضف مواعيدك", "Set Availability")}</p>
              <p className="text-xs text-muted">{t("حدد أوقات إتاحتك", "Define your schedule")}</p>
            </div>
            <Calendar size={16} className="mr-auto text-gold" />
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold">٢</div>
            <div>
              <p className="text-sm font-medium">{t("انتظر حجزاً", "Wait for Bookings")}</p>
              <p className="text-xs text-muted">{t("سيحجز الطلاب معك", "Students will book with you")}</p>
            </div>
            <Clock size={16} className="mr-auto text-gold" />
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold">٣</div>
            <div>
              <p className="text-sm font-medium">{t("أكّد وابدأ", "Confirm & Start")}</p>
              <p className="text-xs text-muted">{t("أكّد الحجز وابدأ التدريس", "Confirm and start teaching")}</p>
            </div>
            <CheckCircle size={16} className="mr-auto text-gold" />
          </div>
        </div>
        <Link href="/teacher/availability" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-gold-hover">
          <Calendar size={16} />
          {t("أضف مواعيدك", "Set Availability")}
        </Link>
      </div>
    );
  }

  return null;
}
