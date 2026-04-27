"use client";

import Link from "next/link";
import { FileText, Calendar, Clock, CheckCircle, AlertCircle, User, BookOpen } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

type CvStatus = "draft" | "pending_review" | "approved" | "rejected";

interface OnboardingState {
  cvStatus: CvStatus;
  hasProfile: boolean;
  hasBio: boolean;
  hasAvailability: boolean;
  hasStudents: boolean;
}

export function TeacherGuidanceBanner({ cvStatus, hasStudents, hasProfile, hasBio, hasAvailability }: OnboardingState) {
  const { t } = useLang();

  // If fully onboarded with students, no banner needed
  if (cvStatus === "approved" && hasStudents) return null;

  // Compute checklist
  const steps = [
    {
      key: "profile",
      label: t("أكمل بياناتك الشخصية", "Complete your profile"),
      description: t("الاسم والهاتف والمنطقة الزمنية", "Name, phone, timezone"),
      done: hasProfile,
      href: "/teacher/cv",
      icon: User,
    },
    {
      key: "cv",
      label: t("أكمل السيرة الذاتية", "Complete your CV"),
      description: t("التخصصات والسيرة والقراءات", "Specialties, bio, recitations"),
      done: hasBio && (cvStatus === "pending_review" || cvStatus === "approved"),
      href: "/teacher/cv",
      icon: FileText,
    },
    {
      key: "review",
      label: t("مراجعة الإدارة", "Admin review"),
      description: cvStatus === "pending_review"
        ? t("قيد المراجعة — سنرد عليك قريباً", "Under review — we'll get back to you soon")
        : cvStatus === "rejected"
        ? t("مرفوضة — يرجى التعديل", "Rejected — please revise")
        : t("أرسل سيرتك الذاتية للمراجعة", "Submit your CV for review"),
      done: cvStatus === "approved",
      href: cvStatus === "rejected" ? "/teacher/cv" : undefined,
      icon: CheckCircle,
      pending: cvStatus === "pending_review",
      error: cvStatus === "rejected",
    },
    {
      key: "availability",
      label: t("أضف مواعيدك", "Set availability"),
      description: t("حدد أوقات إتاحتك للتدريس", "Define your teaching schedule"),
      done: hasAvailability,
      href: "/teacher/availability",
      icon: Calendar,
    },
    {
      key: "students",
      label: t("استقبل أول طالب", "Get your first student"),
      description: t("سيحجز الطلاب معك بعد إتمام الخطوات", "Students will book once you're set up"),
      done: hasStudents,
      icon: BookOpen,
    },
  ];

  const completedSteps = steps.filter(s => s.done).length;
  const totalSteps = steps.length;
  const pct = Math.round((completedSteps / totalSteps) * 100);

  return (
    <div className="glass-card mt-6 border-gold/20 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">
            {completedSteps === totalSteps
              ? t("مبارك! أنت جاهز للتدريس", "You're ready to teach!")
              : t("إعداد حسابك", "Account Setup")}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {t(`${completedSteps} من ${totalSteps} خطوات مكتملة`, `${completedSteps} of ${totalSteps} steps complete`)}
          </p>
        </div>
        <div className="text-center">
          <p className="font-display text-2xl font-bold text-gold">{pct}%</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full bg-gradient-to-l from-gold to-gold/60 transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Checklist */}
      <ol className="mt-5 space-y-3">
        {steps.map(step => {
          const Icon = step.icon;
          const isActive = !step.done && !step.pending;
          const isCurrent = isActive || step.error;

          return (
            <li
              key={step.key}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex items-center gap-3 rounded-xl p-3 transition-colors ${
                step.done ? "bg-emerald-500/5" : step.error ? "bg-error/5" : step.pending ? "bg-blue-500/5" : "bg-foreground/5"
              }`}
            >
              {/* Status icon */}
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                step.done ? "bg-emerald-500/20" : step.error ? "bg-error/20" : step.pending ? "bg-blue-500/20" : "bg-foreground/10"
              }`}>
                {step.done ? (
                  <CheckCircle size={16} className="text-emerald-400" aria-label={t("مكتمل", "Done")} />
                ) : step.error ? (
                  <AlertCircle size={16} className="text-error" aria-label={t("خطأ", "Error")} />
                ) : step.pending ? (
                  <Clock size={16} className="text-blue-400 animate-pulse" aria-label={t("قيد المراجعة", "Pending")} />
                ) : (
                  <Icon size={16} className="text-muted" aria-hidden="true" />
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${step.done ? "text-emerald-400 line-through" : step.error ? "text-error" : ""}`}>
                  {step.label}
                </p>
                <p className="text-xs text-muted">{step.description}</p>
              </div>

              {/* Action */}
              {step.href && isActive && (
                <Link
                  href={step.href}
                  className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-gold/30 bg-gold/10 px-4 py-2 text-xs font-medium text-gold transition-colors hover:bg-gold/20"
                >
                  {step.error ? t("تعديل", "Fix") : t("ابدأ", "Start")}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
