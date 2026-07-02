/**
 * Single source of truth for POLICY copy (decision 45, Wave 1).
 *
 * The 7-persona review found the live site contradicting itself (paid vs free
 * trial, "missed sessions never made up" vs the approved excused-absence
 * policy). This repo has no i18n dictionary — copy is inline `t(ar, en)`
 * pairs — so this const module is the anti-contradiction mechanism: every
 * surface that states a policy imports it from here. Short/long variants
 * exist because a card caption and an FAQ answer legitimately differ in
 * length but must encode the SAME facts (tested in policies.test.ts).
 *
 * Policy sources: parent plan decisions 7/11 (absence), 18 (payout cadence),
 * 40 (free 30-min evaluation, once per student, WhatsApp-confirmed),
 * 10 + line 139 (group sessions 60 min).
 */

export interface PolicyCopy {
  ar: string;
  en: string;
}

/** Decision 40: free, 30 minutes, once per student, booked/confirmed via
 *  WhatsApp (the no-show instrument) — supersedes the old "paid trial" copy. */
export const TRIAL_POLICY = {
  short: {
    ar: "حصة تقييم مجانية (٣٠ دقيقة)",
    en: "Free 30-minute evaluation session",
  },
  long: {
    ar: "نعم — تتوفر حصة تقييم مجانية لمدة ٣٠ دقيقة لتجربة المعلم والأسلوب قبل الاشتراك، مرة واحدة لكل طالب. تُحجز وتُؤكَّد عبر واتساب.",
    en: "Yes — a free 30-minute evaluation session lets you try the teacher and the approach before subscribing, once per student. Booked and confirmed via WhatsApp.",
  },
} satisfies Record<string, PolicyCopy>;

/** Decisions 7 + 11: excused absence with ≥2h notice → rescheduled at no
 *  cost; unexcused → counts toward the plan; the teacher approves excuses. */
export const ABSENCE_POLICY = {
  short: {
    ar: "غياب بعذر (إخطار قبل ساعتين على الأقل) → تُعاد جدولة الحصة",
    en: "Excused absence (at least 2h notice) → session rescheduled",
  },
  long: {
    ar: "إذا أخطرت معلمك قبل الحصة بساعتين على الأقل بعذر مقبول، تُعاد جدولة الحصة دون خصم من باقتك. الغياب دون إخطار كافٍ يُحتسب من الباقة. قبول العذر يعود للمعلم.",
    en: "Notify your teacher at least 2 hours before the session with a valid excuse and it is rescheduled at no cost to your plan. Missing without adequate notice counts toward your plan. The teacher approves the excuse.",
  },
} satisfies Record<string, PolicyCopy>;

/** Decision 18: monthly payout at the start of the following month, based on
 *  hours actually taught — the site must never promise "weekly". */
export const PAY_CADENCE = {
  ar: "دفعات شهرية شفافة أول كل شهر، بحسب ساعات التدريس الفعلية.",
  en: "Transparent monthly payouts at the start of each month, based on hours actually taught.",
} satisfies PolicyCopy;

/** Decision 10 + plan line 139 (group = 60 min); decision 40 (evaluation = 30 min).
 *  Hourly rates are per hour by definition — never append a fake session length. */
export const SESSION_DURATION = {
  group: {
    ar: "مدة الحصة الجماعية ٦٠ دقيقة",
    en: "Group sessions are 60 minutes",
  },
  evaluation: {
    ar: "حصة التقييم ٣٠ دقيقة",
    en: "The evaluation session is 30 minutes",
  },
} satisfies Record<string, PolicyCopy>;

/** Decision 42: two pricing systems stay public, explained honestly — plans
 *  are subscriptions; teacher hourly rates are on-demand single sessions for
 *  enrolled students (not directly purchasable online today). */
export const PRICING_MODEL = {
  disambiguator: {
    ar: "الباقات أدناه اشتراكات شهرية. أسعار الساعة الظاهرة على صفحات المعلمين خاصة بالحصص المفردة عند الطلب للطلاب المسجّلين.",
    en: "The plans below are monthly subscriptions. Hourly rates on teacher pages apply to on-demand single sessions for enrolled students.",
  },
  teacherRateCaption: {
    ar: "للحصص المفردة عند الطلب — الاشتراكات الشهرية حسب الباقات",
    en: "For on-demand single sessions — monthly subscriptions are priced by plan",
  },
} satisfies Record<string, PolicyCopy>;
