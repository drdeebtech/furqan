import type { BookingStatus, SessionType, RecitationStandard, HomeworkType, HomeworkStatus, PackageType, StudentPackageStatus } from "@/types/database";

export const SESSION_TYPE_AR: Record<SessionType, string> = {
  hifz: "حفظ",
  muraja: "مراجعة",
  tajweed: "تجويد",
  tilawa: "تلاوة",
  qiraat: "قراءات",
  tafsir: "تفسير",
  combined: "حفظ + مراجعة",
  other: "أخرى",
};

export const SESSION_TYPE_BILINGUAL: Record<SessionType, { ar: string; en: string }> = {
  hifz: { ar: "حفظ", en: "Hifz" },
  muraja: { ar: "مراجعة", en: "Muraja'a" },
  tajweed: { ar: "تجويد", en: "Tajweed" },
  tilawa: { ar: "تلاوة", en: "Tilawa" },
  qiraat: { ar: "قراءات", en: "Qira'at" },
  tafsir: { ar: "تفسير", en: "Tafsir" },
  combined: { ar: "حفظ + مراجعة", en: "Hifz + Muraja'a" },
  other: { ar: "أخرى", en: "Other" },
};

export const RIWAYA_AR: Record<RecitationStandard, string> = {
  hafs: "حفص",
  warsh: "ورش",
  qalon: "قالون",
  al_duri: "الدوري",
  shu_ba: "شعبة",
};

export const STATUS_STYLE: Record<
  BookingStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "بانتظار التأكيد",
    className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  },
  confirmed: {
    label: "مؤكد",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  completed: {
    label: "مكتمل",
    className: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  },
  cancelled: {
    label: "ملغى",
    className: "bg-red-500/10 text-red-400 border-red-500/30",
  },
  no_show: {
    label: "لم يحضر",
    className: "bg-red-500/10 text-red-400 border-red-500/30",
  },
};

// ─── V10: Homework labels ───────────────────────────────────────────────────

export const HOMEWORK_TYPE_AR: Record<HomeworkType, string> = {
  hifz: "حفظ",
  muraja: "مراجعة",
  recitation: "تلاوة",
  tajweed: "تجويد",
  writing: "كتابة",
  listening: "استماع",
};

export const HOMEWORK_TYPE_BILINGUAL: Record<HomeworkType, { ar: string; en: string }> = {
  hifz: { ar: "حفظ", en: "Hifz (Memorization)" },
  muraja: { ar: "مراجعة", en: "Muraja'a (Review)" },
  recitation: { ar: "تلاوة", en: "Recitation" },
  tajweed: { ar: "تجويد", en: "Tajweed" },
  writing: { ar: "كتابة", en: "Writing" },
  listening: { ar: "استماع", en: "Listening" },
};

export const HOMEWORK_STATUS_AR: Record<HomeworkStatus, string> = {
  assigned: "تم التكليف",
  student_ready: "جاهز",
  completed_excellent: "ممتاز",
  completed_good: "جيد",
  completed_needs_work: "يحتاج تحسين",
  completed_not_done: "لم يُنجز",
};

export const HOMEWORK_STATUS_BILINGUAL: Record<HomeworkStatus, { ar: string; en: string }> = {
  assigned: { ar: "تم التكليف", en: "Assigned" },
  student_ready: { ar: "جاهز", en: "Ready" },
  completed_excellent: { ar: "ممتاز", en: "Excellent" },
  completed_good: { ar: "جيد", en: "Good" },
  completed_needs_work: { ar: "يحتاج تحسين", en: "Needs Work" },
  completed_not_done: { ar: "لم يُنجز", en: "Not Done" },
};

export const HOMEWORK_STATUS_STYLE: Record<HomeworkStatus, { label: string; className: string }> = {
  assigned: { label: "تم التكليف", className: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  student_ready: { label: "جاهز", className: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  completed_excellent: { label: "ممتاز", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  completed_good: { label: "جيد", className: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  completed_needs_work: { label: "يحتاج تحسين", className: "bg-orange-500/10 text-orange-400 border-orange-500/30" },
  completed_not_done: { label: "لم يُنجز", className: "bg-red-500/10 text-red-400 border-red-500/30" },
};

// ─── V11: Package labels ────────────────────────────────────────────────────

export const PACKAGE_TYPE_AR: Record<PackageType, string> = {
  single_session: "جلسة واحدة",
  pack_4: "٤ جلسات",
  pack_8: "٨ جلسات",
  pack_12: "١٢ جلسة",
  full_course: "دورة كاملة",
};

export const PACKAGE_TYPE_BILINGUAL: Record<PackageType, { ar: string; en: string }> = {
  single_session: { ar: "جلسة واحدة", en: "Single Session" },
  pack_4: { ar: "٤ جلسات", en: "4 Sessions" },
  pack_8: { ar: "٨ جلسات", en: "8 Sessions" },
  pack_12: { ar: "١٢ جلسة", en: "12 Sessions" },
  full_course: { ar: "دورة كاملة", en: "Full Course" },
};

export const STUDENT_PACKAGE_STATUS_STYLE: Record<StudentPackageStatus, { label: string; className: string }> = {
  active: { label: "نشطة", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  expired: { label: "منتهية", className: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  cancelled: { label: "ملغاة", className: "bg-red-500/10 text-red-400 border-red-500/30" },
};
