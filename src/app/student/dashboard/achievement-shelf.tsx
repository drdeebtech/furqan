"use client";

import {
  Award,
  BookOpen,
  Flame,
  GraduationCap,
  PlayCircle,
  Shield,
  Trophy,
  Zap,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import { BADGE_CATALOG, type AchievementType } from "@/lib/domains/achievements/catalog";

type IconComponent = ComponentType<LucideProps>;

const ICON_MAP: Record<string, IconComponent> = {
  Award,
  BookOpen,
  Flame,
  GraduationCap,
  PlayCircle,
  Shield,
  Trophy,
  Zap,
};

export type EarnedAchievement = {
  type: string;
  metadata_json: Record<string, unknown>;
  unlocked_at: string;
};

interface AchievementShelfProps {
  achievements: EarnedAchievement[];
}

export function AchievementShelf({ achievements }: AchievementShelfProps) {
  if (Object.keys(BADGE_CATALOG).length === 0) return null;

  const earnedMap = new Map<string, EarnedAchievement>(
    achievements.map((a) => [a.type, a]),
  );
  const entries = Object.values(BADGE_CATALOG) as (typeof BADGE_CATALOG)[AchievementType][];

  return (
    <section
      aria-label="الإنجازات"
      aria-live="polite"
      className="mb-6"
    >
      <div className="flex flex-wrap gap-3" dir="rtl">
        {entries.map((badge) => {
          const earned = earnedMap.get(badge.type);
          const Icon: IconComponent = ICON_MAP[badge.icon] ?? Award;
          const dateLabel = earned
            ? new Date(earned.unlocked_at).toLocaleDateString("ar-EG", {
                day: "numeric",
                month: "short",
              })
            : null;

          return (
            <div
              key={badge.type}
              title={earned ? `${badge.labelAr} — ${dateLabel}` : badge.descriptionAr}
              className={[
                "flex flex-col items-center gap-1 rounded-xl border px-3 py-2 transition-all",
                earned
                  ? "border-amber-400 bg-amber-50 text-amber-700 shadow-sm"
                  : "border-gray-200 bg-gray-50 text-gray-300 opacity-50 grayscale",
              ].join(" ")}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="text-xs font-medium leading-none">
                {badge.labelAr}
              </span>
              {earned && dateLabel && (
                <span className="text-[10px] text-amber-500 leading-none">
                  {dateLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
