import type { BookingStatus, SessionType, RecitationStandard } from "@/types/database";

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
