/**
 * Achievement badge catalog — spec 033.
 *
 * Static TS object (not a DB table). Badge *definitions* live here; earned rows
 * live in public.achievements. Promote to a DB table only if admin-managed badges
 * are ever needed (YAGNI).
 *
 * first_correction_clean is included for aspirational display but is NOT awarded
 * by any code path — semantics are unresolved (see spec.md OPEN DECISIONS).
 */

export type AchievementType =
  | "first_session"
  | "first_juz"
  | "streak_7"
  | "streak_30"
  | "first_correction_clean"
  | "level_up_intermediate"
  | "level_up_advanced";

export interface BadgeDef {
  type: AchievementType;
  /** Arabic label (primary — RTL UI). */
  labelAr: string;
  /** English label (secondary). */
  labelEn: string;
  /** Short Arabic description shown as tooltip / locked state. */
  descriptionAr: string;
  /** Lucide icon component name. */
  icon: string;
  /**
   * Whether this badge is currently awardable by code.
   * false = shown greyed-out / aspirational, never inserted by award.ts.
   */
  awardable: boolean;
}

export const BADGE_CATALOG: Record<AchievementType, BadgeDef> = {
  first_session: {
    type: "first_session",
    labelAr: "أول جلسة",
    labelEn: "First Session",
    descriptionAr: "أكملت أول جلسة حفظ",
    icon: "PlayCircle",
    awardable: true,
  },
  first_juz: {
    type: "first_juz",
    labelAr: "أول جزء",
    labelEn: "First Juz",
    descriptionAr: "حفظت أول جزء كامل",
    icon: "BookOpen",
    awardable: true,
  },
  streak_7: {
    type: "streak_7",
    labelAr: "أسبوع متواصل",
    labelEn: "7-Day Streak",
    descriptionAr: "حافظت على الحفظ لأسبوع متواصل",
    icon: "Flame",
    awardable: true,
  },
  streak_30: {
    type: "streak_30",
    labelAr: "شهر متواصل",
    labelEn: "30-Day Streak",
    descriptionAr: "حافظت على الحفظ لشهر كامل",
    icon: "Zap",
    awardable: true,
  },
  // ponytail: first_correction_clean semantics are unresolved — catalog entry kept
  // for aspirational display; award.ts never inserts it. See spec.md OPEN DECISIONS.
  first_correction_clean: {
    type: "first_correction_clean",
    labelAr: "تصحيح نظيف",
    labelEn: "Clean Correction",
    descriptionAr: "أكملت جلسة تصحيح بجودة عالية",
    icon: "Shield",
    awardable: false,
  },
  level_up_intermediate: {
    type: "level_up_intermediate",
    labelAr: "مستوى متوسط",
    labelEn: "Intermediate Level",
    descriptionAr: "تقدمت إلى المستوى المتوسط",
    icon: "GraduationCap",
    awardable: true,
  },
  level_up_advanced: {
    type: "level_up_advanced",
    labelAr: "مستوى متقدم",
    labelEn: "Advanced Level",
    descriptionAr: "تقدمت إلى المستوى المتقدم",
    icon: "Trophy",
    awardable: true,
  },
};
