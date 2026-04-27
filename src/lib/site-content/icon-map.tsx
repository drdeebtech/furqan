import {
  Award,
  BookOpen,
  Calendar,
  CheckCircle,
  Clock,
  Globe,
  GraduationCap,
  Heart,
  HelpCircle,
  Package,
  Shield,
  Star,
  TrendingUp,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

// String-keyed lookup so admin-edited DB rows can name an icon by string.
// New icons should be added here AND surfaced in the admin form's dropdown.
export const SITE_ICONS: Record<string, LucideIcon> = {
  Award,
  BookOpen,
  Calendar,
  CheckCircle,
  Clock,
  Globe,
  GraduationCap,
  Heart,
  Package,
  Shield,
  Star,
  TrendingUp,
  Users,
  Video,
};

export const SITE_ICON_NAMES = Object.keys(SITE_ICONS).sort();

export function resolveIcon(name: string): LucideIcon {
  return SITE_ICONS[name] ?? HelpCircle;
}
