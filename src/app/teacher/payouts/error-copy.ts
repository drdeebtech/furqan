// Client-safe localization for payout action failures (CodeRabbit: the
// server's Arabic fallback strings must not render untranslated in English
// mode). Unknown codes fall back to the server-provided Arabic string.

import type { PayoutActionErrorCode } from "@/lib/actions/teacher-payouts";

const ERROR_COPY: Record<PayoutActionErrorCode, { ar: string; en: string }> = {
  unauthorized: { ar: "غير مصرح — يرجى تسجيل الدخول", en: "Not authorized — please sign in." },
  retry: { ar: "حدث خطأ — حاول مجددًا", en: "Something went wrong — please try again." },
  not_teacher: { ar: "هذه الصفحة مخصصة للمعلمين فقط", en: "This page is for teachers only." },
  not_approved: {
    ar: "يتاح إعداد المدفوعات بعد اعتماد ملفك التعليمي",
    en: "Payout setup opens once your teaching profile is approved.",
  },
  agreement_draft: {
    ar: "الاتفاقية غير متاحة للموافقة بعد — النص النهائي قيد المراجعة",
    en: "The agreement is not yet open for acceptance — the final text is under review.",
  },
  version_changed: {
    ar: "تم تحديث الاتفاقية — يرجى قراءة النسخة الجديدة والموافقة عليها",
    en: "The agreement was updated — please read and accept the new version.",
  },
  not_live: { ar: "سيتاح إعداد المدفوعات قريبًا", en: "Payout setup is coming soon." },
  unavailable: { ar: "الخدمة غير متاحة حاليًا — حاول لاحقًا", en: "Service unavailable — try later." },
};

export function localizePayoutError(
  code: PayoutActionErrorCode | undefined,
  fallback: string,
  lang: "ar" | "en",
): string {
  if (!code || !(code in ERROR_COPY)) return fallback;
  const copy = ERROR_COPY[code];
  return lang === "ar" ? copy.ar : copy.en;
}
