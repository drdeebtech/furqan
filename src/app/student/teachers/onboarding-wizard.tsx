"use client";

/**
 * Issue #545 — guided 3-step onboarding wizard for brand-new students.
 *
 * Renders at `/student/teachers?new=1` when the student has not yet
 * completed onboarding. The dashboard guard redirects here; step 3's
 * "finish" control calls the `completeOnboarding` server action which
 * flips `profiles.onboarding_completed` (userId from the session), then
 * routes the student to their dashboard — so the wizard is shown exactly
 * once.
 *
 * Reuses existing surfaces rather than reinventing them:
 *   - Step 1 → <TeacherList/> (the real teacher-browse component).
 *   - Step 2 → plan cards built from the SAME `subscription_plans` rows the
 *     public /pricing page reads, each linking into the real /subscribe
 *     checkout entry (no fabricated tiers or prices).
 *   - Step 3 → links into the existing /student/bookings/new flow.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, CreditCard, CalendarPlus, ArrowLeft, ArrowRight, CheckCircle, Users, User } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { TeacherList } from "@/app/student/teachers/teacher-list";
import type { TeacherLanguage } from "@/lib/site-content/types";
import type { TeacherData } from "@/app/student/teachers/types";
import type { LoudResult } from "@/lib/actions/loud";

/** A live row from `subscription_plans` — same shape /pricing reads. */
export interface OnboardingPlan {
  id: string;
  plan_code: string;
  name: string;
  monthly_credit_count: number;
  price_cents: number;
}

interface WizardProps {
  teachers: TeacherData[];
  specialtyLabels: TeacherLanguage[];
  studentStandard: string | null;
  canBook: boolean;
  plans: OnboardingPlan[];
  /** Server action reference (serializable) — flips onboarding_completed. */
  completeAction: () => Promise<LoudResult>;
}

type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, { ar: string; en: string }> = {
  1: { ar: "اختيار المعلم", en: "Choose Teacher" },
  2: { ar: "اختيار الخطة", en: "Choose Plan" },
  3: { ar: "حجز الجلسة الأولى", en: "Book First Session" },
};

function formatPrice(priceCents: number): string {
  return `$${(priceCents / 100).toFixed(0)}`;
}

function sessionLabel(
  plan: OnboardingPlan,
  t: (ar: string, en: string) => string,
): string {
  const n = plan.monthly_credit_count;
  if (plan.plan_code.startsWith("hifz_individual")) {
    return t(`${n} ساعة / شهر`, `${n} hours / month`);
  }
  return t(`${n} جلسات / شهر`, `${n} sessions / month`);
}

export function OnboardingWizard({
  teachers,
  specialtyLabels,
  studentStandard,
  canBook,
  plans,
  completeAction,
}: WizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { t, dir, lang } = useLang();
  const router = useRouter();

  const backArrow = dir === "rtl" ? <ArrowRight size={14} aria-hidden="true" /> : <ArrowLeft size={14} aria-hidden="true" />;
  const fwdArrow = dir === "rtl" ? <ArrowLeft size={14} aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />;

  function onFinish() {
    setError(null);
    startTransition(async () => {
      const res = await completeAction();
      if (res.ok) {
        router.push("/student/dashboard");
      } else {
        setError(res.error);
      }
    });
  }

  function pillClass(s: Step): string {
    if (s === step) return "flex items-center gap-1.5 rounded-full px-3 py-1.5 glass glass-gold font-bold text-gold";
    if (s < step) return "flex items-center gap-1.5 rounded-full px-3 py-1.5 glass glass-success text-success";
    return "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted/50";
  }
  function dotClass(s: Step): string {
    if (s === step) return "flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold bg-gold text-background";
    if (s < step) return "flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold bg-success text-background";
    return "flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold bg-white/10 text-muted";
  }

  return (
    <>
      {/* Step indicator: "الخطوة N من 3" */}
      <nav aria-label={t("خطوات التأهيل", "Onboarding steps")} dir={dir}>
        <ol className="mx-auto flex max-w-5xl items-center justify-center gap-1 px-4 pt-6 text-xs sm:gap-2 sm:text-sm">
          {([1, 2, 3] as Step[]).map((s, i) => (
            <li key={s} className="flex items-center gap-1 sm:gap-2">
              {i > 0 && (
                <span aria-hidden="true" className="hidden text-muted/40 sm:inline">←</span>
              )}
              <div className={pillClass(s)}>
                <span className={dotClass(s)}>{s < step ? "✓" : s}</span>
                <span className="hidden sm:inline">{t(STEP_LABELS[s].ar, STEP_LABELS[s].en)}</span>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-center text-xs text-muted">
          {t("الخطوة " + step + " من 3", "Step " + step + " of 3")}
        </p>
      </nav>


      {/* Contextual intro — what Furqan is + what happens next */}
      <section dir={dir} className="mx-auto mb-2 max-w-5xl px-4">
        <div className="glass-card p-5 text-center">
          <p className="text-lg font-bold text-gold">
            {t(
              "أهلاً بك في فرقان — منصتك لحفظ القرآن مع معلمين مُجازين",
              "Welcome to Furqan — your platform for memorizing the Quran with certified teachers",
            )}
          </p>
          <p className="mt-1 text-sm text-muted">
            {t(
              "ثلاث خطوات بسيطة تفصلك عن جلستك الأولى: اختر معلمك، ثم اختر الخطة المناسبة، ثم احجز موعدك.",
              "Three simple steps stand between you and your first session: pick your teacher, choose a plan that fits you, then book your slot.",
            )}
          </p>
        </div>
      </section>

      {/* Step bodies */}
      {step === 1 && (
        <>
          {/* Step 1 reuses the real teacher-list component unchanged. */}
          <TeacherList
            teachers={teachers}
            specialtyLabels={specialtyLabels}
            studentStandard={studentStandard}
            canBook={canBook}
          />
          <div dir={dir} className="mx-auto mb-10 flex max-w-5xl items-center justify-between gap-3 px-4">
            <span className="text-xs text-muted">
              {t("بعد اختيار معلم، تابع لاختيار الخطة.", "Once you've picked a teacher, continue to choose your plan.")}
            </span>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg glass-gold px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-hover focus-ring"
            >
              {t("التالي: اختر الخطة", "Next: Choose plan")}
              {fwdArrow}
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
          <div className="mb-6 flex items-center gap-2">
            <CreditCard size={24} className="text-gold" />
            <h2 className="font-display text-2xl font-bold">{t("اختر خطة الاشتراك", "Choose your plan")}</h2>
          </div>

          {plans.length === 0 ? (
            <div className="glass-card p-8 text-center text-muted">
              {t(
                "لا توجد خطط متاحة حالياً — يمكنك المتابعة والحجز لاحقاً.",
                "No plans available right now — you can continue and book later.",
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {plans.map((plan) => (
                <div key={plan.id} className="glass-card flex flex-col gap-3 p-6">
                  <div className="flex items-center gap-2 text-muted">
                    {plan.plan_code.startsWith("hifz_group") ? <Users size={16} aria-hidden="true" /> : <User size={16} aria-hidden="true" />}
                    <span className="text-xs font-medium uppercase tracking-widest">
                      {plan.plan_code.startsWith("hifz_group") ? t("حلقة جماعية", "Group") : t("جلسة فردية", "Individual")}
                    </span>
                  </div>
                  <h3 className="font-display text-lg font-bold">{plan.name}</h3>
                  <p className="text-xs text-muted">{sessionLabel(plan, t)}</p>
                  <p className="font-display text-3xl font-bold" dir="ltr">
                    {formatPrice(plan.price_cents)}
                    <span className="text-base font-normal text-muted"> / {t("شهر", "mo")}</span>
                  </p>
                  {/* Real checkout entry — identical target to /pricing. */}
                  <Link
                    href={`/subscribe?plan=${plan.plan_code}`}
                    className="glass-gold glass-pill inline-flex min-h-[44px] items-center justify-center px-4 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-gold-hover focus-ring"
                  >
                    {t("اختيار هذه الخطة", "Choose this plan")}
                  </Link>
                </div>
              ))}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gold transition-colors hover:text-gold-light focus-ring"
            >
              {backArrow}
              {t("السابق", "Back")}
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg glass-gold px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-hover focus-ring"
            >
              {t("التالي: احجز جلستك الأولى", "Next: Book your first session")}
              {fwdArrow}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div dir={dir} className="mx-auto max-w-3xl px-4 py-8">
          <div className="mb-6 flex items-center gap-2">
            <CalendarPlus size={24} className="text-gold" />
            <h2 className="font-display text-2xl font-bold">{t("احجز جلستك الأولى", "Book your first session")}</h2>
          </div>
          <div className="glass-card space-y-4 p-6">
            <p className="text-sm text-muted">
              {t(
                "اختر معلماً ووقتاً يناسبك لتبدأ رحلة الحفظ. الدفع آمن عبر Stripe، ويمكنك إلغاء الاشتراك في أي وقت.",
                "Pick a teacher and a time that suits you to begin your memorisation journey. Payment is secure via Stripe, and you can cancel anytime.",
              )}
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <CheckCircle size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                <span className="text-muted">
                  {t("تصفّح المعلمين واحجز عبر صفحة المعلمين.", "Browse teachers and book from the teachers page.")}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                <span className="text-muted">
                  {t("جلسات فيديو مباشرة مع متابعة أسبوعية لحفظك.", "Live video sessions with weekly memorisation follow-up.")}
                </span>
              </li>
            </ul>
            <div className="h-px bg-white/10" />
            {/* Links into the existing booking flow. */}
            <Link
              href="/student/teachers"
              className="glass-gold inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-background transition-colors hover:bg-gold-hover focus-ring"
            >
              <GraduationCap size={16} aria-hidden="true" />
              {t("احجز جلسة الآن", "Book a session now")}
            </Link>
            <p className="text-center text-xs text-muted">
              {t(
                "عند الانتهاء، اضغط الزر أدناه للانتقال إلى لوحة التحكم.",
                "When you're done, press the button below to go to your dashboard.",
              )}
            </p>
            <button
              type="button"
              onClick={onFinish}
              disabled={pending}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-gold/50 px-5 py-3 text-sm font-semibold text-gold transition-colors hover:border-gold/80 disabled:opacity-60 focus-ring"
            >
              {pending ? t("جارٍ التأكيد…", "Confirming…") : t("إنهاء التأهيل والذهاب للوحة التحكم", "Finish onboarding & go to dashboard")}
            </button>
            {error && (
              <p role="alert" className="text-center text-sm text-error">
                {error}
              </p>
            )}
          </div>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gold transition-colors hover:text-gold-light focus-ring"
            >
              {backArrow}
              {t("السابق", "Back")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
