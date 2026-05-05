"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Calendar,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Inbox,
  LogIn,
  LogOut,
  MessageSquare,
  Shield,
  Star,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useLang } from "@/lib/i18n/context";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  id: string;
  type:
    | "booking_created"
    | "session_started"
    | "session_ended"
    | "homework_created"
    | "homework_graded"
    | "evaluation_created"
    | "notification_sent"
    | "audit"
    | "auth_login"
    | "auth_logout"
    | "payment";
  at: string;
  title_ar: string;
  title_en: string;
  detail?: string;
  href?: string;
  icon: "calendar" | "video" | "book-open" | "star" | "bell" | "shield" | "dollar-sign" | "log-in" | "log-out";
  color: "blue" | "green" | "amber" | "purple" | "gold" | "muted" | "red";
}

type FilterKey = "all" | "bookings" | "sessions" | "homework" | "evaluations" | "notifications" | "audit" | "auth";

interface Props {
  userId: string;
  userName: string;
  userRole: string;
  memberSince: string;
  events: TimelineEvent[];
}

// ── Icon registry ─────────────────────────────────────────────────────────────

const ICONS: Record<TimelineEvent["icon"], LucideIcon> = {
  calendar: Calendar,
  video: Video,
  "book-open": BookOpen,
  star: Star,
  bell: Bell,
  shield: Shield,
  "dollar-sign": DollarSign,
  "log-in": LogIn,
  "log-out": LogOut,
};

// ── Color tokens — keep in sync with project's glass/gold design system ───────

const COLORS: Record<
  TimelineEvent["color"],
  { bg: string; text: string; border: string; ring: string }
> = {
  blue: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/30",
    ring: "ring-blue-500/20",
  },
  green: {
    bg: "bg-green-500/10",
    text: "text-green-400",
    border: "border-green-500/30",
    ring: "ring-green-500/20",
  },
  amber: {
    bg: "bg-warning/10",
    text: "text-warning",
    border: "border-warning/30",
    ring: "ring-amber-500/20",
  },
  purple: {
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    border: "border-purple-500/30",
    ring: "ring-purple-500/20",
  },
  gold: {
    bg: "bg-gold/10",
    text: "text-gold",
    border: "border-gold/30",
    ring: "ring-gold/20",
  },
  red: {
    bg: "bg-error/10",
    text: "text-red-400",
    border: "border-error/30",
    ring: "ring-red-500/20",
  },
  muted: {
    bg: "bg-white/5",
    text: "text-muted",
    border: "border-white/10",
    ring: "ring-white/5",
  },
};

// ── Filter routing ────────────────────────────────────────────────────────────

const FILTER_TYPES: Record<FilterKey, TimelineEvent["type"][] | null> = {
  all: null,
  bookings: ["booking_created"],
  sessions: ["session_started", "session_ended"],
  homework: ["homework_created", "homework_graded"],
  evaluations: ["evaluation_created"],
  notifications: ["notification_sent"],
  audit: ["audit"],
  auth: ["auth_login", "auth_logout"],
};

// ── Relative time formatting (no lib dep) ─────────────────────────────────────

function relativeTime(iso: string, lang: "ar" | "en"): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (lang === "ar") {
    if (mins < 1) return "الآن";
    if (mins < 60) return `منذ ${mins} د`;
    if (hours < 24) return `منذ ${hours} س`;
    if (days < 30) return `منذ ${days} ي`;
    return new Date(iso).toLocaleDateString("ar", { month: "short", day: "numeric" });
  }
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Page size ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// ── Component ─────────────────────────────────────────────────────────────────

export function TimelineClient({
  userId,
  userName,
  userRole,
  memberSince,
  events,
}: Props) {
  const { t, lang, dir } = useLang();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [page, setPage] = useState(0);

  // Apply client-side filter
  const filtered = useMemo(() => {
    const types = FILTER_TYPES[filter];
    if (!types) return events;
    const set = new Set(types);
    return events.filter((e) => set.has(e.type));
  }, [events, filter]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageEvents = useMemo(
    () => filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE),
    [filtered, clampedPage],
  );

  const handleFilter = (next: FilterKey) => {
    setFilter(next);
    setPage(0);
  };

  const FILTER_CHIPS: Array<{ key: FilterKey; label_ar: string; label_en: string }> = [
    { key: "all", label_ar: "الكل", label_en: "All" },
    { key: "bookings", label_ar: "الحجوزات", label_en: "Bookings" },
    { key: "sessions", label_ar: "الجلسات", label_en: "Sessions" },
    { key: "homework", label_ar: "المتابعات", label_en: "Homework" },
    { key: "evaluations", label_ar: "التقييمات", label_en: "Evaluations" },
    { key: "notifications", label_ar: "الإشعارات", label_en: "Notifications" },
    { key: "audit", label_ar: "سجل التدقيق", label_en: "Audit" },
    { key: "auth", label_ar: "الدخول والخروج", label_en: "Auth" },
  ];

  // Count per filter for display in chip
  const counts = useMemo(() => {
    const out: Record<FilterKey, number> = {
      all: events.length,
      bookings: 0,
      sessions: 0,
      homework: 0,
      evaluations: 0,
      notifications: 0,
      audit: 0,
      auth: 0,
    };
    for (const e of events) {
      for (const [key, types] of Object.entries(FILTER_TYPES) as [FilterKey, TimelineEvent["type"][] | null][]) {
        if (key === "all" || !types) continue;
        if (types.includes(e.type)) out[key]++;
      }
    }
    return out;
  }, [events]);

  const BackArrow = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      {/* Back link */}
      <Link
        href={`/admin/users/${userId}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover"
      >
        <BackArrow size={14} /> {t("العودة للمستخدم", "Back to user")}
      </Link>

      {/* User header */}
      <div className="glass-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/20 text-xl font-bold text-gold">
              {userName[0]?.toUpperCase() ?? "?"}
            </div>
            <div>
              <h1 className="text-xl font-bold">{userName}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span className="glass-badge border-gold/30 bg-gold/10 text-gold">
                  {userRole}
                </span>
                <span className="text-xs text-muted">
                  {t("عضو منذ", "Member since")}{" "}
                  <span dir="ltr">
                    {new Date(memberSince).toLocaleDateString(
                      lang === "ar" ? "ar" : "en-US",
                      { year: "numeric", month: "short", day: "numeric" },
                    )}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick links */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/admin/users/${userId}`}
            className="glass-pill px-3 py-1.5 text-xs font-medium hover:bg-white/10"
          >
            {t("ملف المستخدم", "User profile")}
          </Link>
          <Link
            href={`/admin/bookings?user=${userId}`}
            className="glass-pill px-3 py-1.5 text-xs font-medium hover:bg-white/10"
          >
            <Calendar size={12} className="me-1 inline" />
            {t("حجوزاته", "Bookings")}
          </Link>
          <Link
            href={`/admin/notifications?user=${userId}`}
            className="glass-pill px-3 py-1.5 text-xs font-medium hover:bg-white/10"
          >
            <MessageSquare size={12} className="me-1 inline" />
            {t("الرسائل", "Messages")}
          </Link>
        </div>
      </div>

      {/* Filter chips */}
      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label={t("تصفية", "Filters")}>
        {FILTER_CHIPS.map((chip) => {
          const active = filter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleFilter(chip.key)}
              className={`glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-gold/50 bg-gold/20 text-gold"
                  : "text-muted hover:bg-white/10"
              }`}
            >
              <span>{t(chip.label_ar, chip.label_en)}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-gold/30" : "bg-white/10"}`}>
                {counts[chip.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Timeline */}
      <div className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">
          {t("الأحداث (آخر ٩٠ يوم)", "Activity (last 90 days)")}
        </h2>

        {pageEvents.length === 0 ? (
          <div className="glass-card rounded-xl p-12 text-center">
            <Inbox size={32} className="mx-auto mb-3 text-muted" />
            <p className="text-sm text-muted">
              {t("لا يوجد نشاط في آخر ٩٠ يومًا.", "No activity in the last 90 days.")}
            </p>
          </div>
        ) : (
          <ol className="relative ps-10">
            {/* Vertical line — sits on the start side (RTL: right, LTR: left) */}
            <span
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-px bg-white/10 start-4"
            />
            {pageEvents.map((event) => (
              <TimelineNode key={event.id} event={event} lang={lang} t={t} />
            ))}
          </ol>
        )}

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="mt-6 flex items-center justify-between text-sm">
            <p className="text-xs text-muted">
              {t("الصفحة", "Page")} {clampedPage + 1} / {totalPages} ·{" "}
              {t(`${filtered.length} حدث`, `${filtered.length} events`)}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={clampedPage === 0}
                className="glass-pill inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={t("السابق", "Previous")}
              >
                {dir === "rtl" ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                {t("السابق", "Previous")}
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={clampedPage >= totalPages - 1}
                className="glass-pill inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={t("التالي", "Next")}
              >
                {t("التالي", "Next")}
                {dir === "rtl" ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Individual node ──────────────────────────────────────────────────────────

interface NodeProps {
  event: TimelineEvent;
  lang: "ar" | "en";
  t: (ar: string, en: string) => string;
}

function TimelineNode({ event, lang, t }: NodeProps) {
  const Icon = ICONS[event.icon];
  const palette = COLORS[event.color];
  const title = lang === "ar" ? event.title_ar : event.title_en;

  const content = (
    <div
      className={`glass-card flex-1 rounded-xl border p-4 transition ${palette.border} ${event.href ? "hover:bg-white/5" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <span dir="ltr" className="text-xs text-muted" title={new Date(event.at).toLocaleString()}>
          {relativeTime(event.at, lang)}
        </span>
      </div>
      {event.detail && (
        <p className="mt-1 text-xs text-muted">{event.detail}</p>
      )}
      {event.href && (
        <p className={`mt-2 text-xs ${palette.text}`}>
          {t("عرض التفاصيل ←", "View details →")}
        </p>
      )}
    </div>
  );

  return (
    <li className="relative mb-3 flex items-start gap-3">
      {/* Icon node — absolute on the start line */}
      <span
        aria-hidden="true"
        className={`absolute start-0 flex h-8 w-8 items-center justify-center rounded-full border ${palette.border} ${palette.bg} ${palette.text} ring-4 ${palette.ring}`}
      >
        <Icon size={14} />
      </span>

      {event.href ? (
        <Link href={event.href} className="block flex-1">
          {content}
        </Link>
      ) : (
        content
      )}
    </li>
  );
}
