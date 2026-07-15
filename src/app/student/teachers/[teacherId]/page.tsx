import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Star, BookOpen, Award, CalendarDays, Mic } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import {
  SESSION_TYPE_AR,
  RIWAYA_AR,
} from "@/lib/constants";
import { getActiveTeacherSpecialties } from "@/lib/site-content/queries";
import { getInstantPrice } from "@/lib/domains/single-sessions/pricing";
import type { GenderType, SessionType, RecitationStandard } from "@/types/database";
import { SingleSessionPurchase } from "./single-session-purchase";

const RIWAYA_EN: Record<RecitationStandard, string> = {
  hafs: "Hafs", warsh: "Warsh", qalon: "Qalon", al_duri: "Al-Duri", shu_ba: "Shu'ba",
};
const DAY_AR: Record<number, string> = {
  0: "الأحد", 1: "الإثنين", 2: "الثلاثاء", 3: "الأربعاء",
  4: "الخميس", 5: "الجمعة", 6: "السبت",
};

interface PageProps {
  params: Promise<{ teacherId: string }>;
}

export const metadata: Metadata = { title: "ملف المعلم" };

export default async function TeacherDetailPage({ params }: PageProps) {
  const { teacherId } = await params;
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/student/teachers/${teacherId}`);

  // Pull profile + teacher_profiles + availability + specialty picklist in parallel.
  const [{ data: profile }, { data: tp }, { data: availability }, specialtyLabels, instantPrice] = await Promise.all([
    supabase
      .from("public_profiles" as "profiles")
      .select("full_name, full_name_ar, avatar_url")
      .eq("id", teacherId)
      .returns<{ full_name: string | null; full_name_ar: string | null; avatar_url: string | null }[]>()
      .single(),
    supabase
      .from("teacher_profiles")
      .select("teacher_id, bio, bio_en, specialties, recitation_standards, hourly_rate, rating_avg, total_sessions, gender, is_archived, is_accepting, cv_status")
      .eq("teacher_id", teacherId)
      .single<{
        teacher_id: string; bio: string | null; bio_en: string | null;
        specialties: string[]; recitation_standards: string[];
        hourly_rate: number; rating_avg: number; total_sessions: number;
        gender: GenderType | null; is_archived: boolean; is_accepting: boolean; cv_status: string;
      }>(),
    supabase
      .from("teacher_availability")
      .select("day_of_week, start_time, end_time")
      .eq("teacher_id", teacherId)
      .eq("is_active", true)
      .order("day_of_week", { ascending: true })
      .returns<{ day_of_week: number; start_time: string; end_time: string }[]>(),
    getActiveTeacherSpecialties(),
    getInstantPrice(),
  ]);

  if (!profile || !tp || tp.is_archived || !tp.is_accepting || tp.cv_status !== "approved") {
    notFound();
  }

  const name =
    (lang === "ar"
      ? profile.full_name_ar ?? profile.full_name
      : profile.full_name ?? profile.full_name_ar) ?? t("معلم", "Teacher");

  const specialtyMap = new Map(specialtyLabels.map((s) => [s.key, { ar: s.label_ar, en: s.label_en }] as const));
  function labelForSpecialty(key: string): string {
    const fromPicklist = specialtyMap.get(key);
    if (fromPicklist) return lang === "ar" ? fromPicklist.ar : fromPicklist.en;
    if (lang === "ar") return SESSION_TYPE_AR[key as SessionType] ?? key;
    return key;
  }
  const bio = lang === "ar" ? (tp.bio ?? tp.bio_en) : (tp.bio_en ?? tp.bio);
  const usedFallback = lang === "ar" ? (!tp.bio && !!tp.bio_en) : (!tp.bio_en && !!tp.bio);
  const bioDir = bio ? dir : undefined;

  // Group availability by day for compact display
  const availabilityByDay = new Map<number, { start: string; end: string }[]>();
  for (const slot of availability ?? []) {
    const list = availabilityByDay.get(slot.day_of_week) ?? [];
    list.push({ start: slot.start_time.slice(0, 5), end: slot.end_time.slice(0, 5) });
    availabilityByDay.set(slot.day_of_week, list);
  }
  const availableDays = [...availabilityByDay.keys()].sort();

  const ratingNum = Number(tp.rating_avg);
  const rating = ratingNum > 0 ? ratingNum.toFixed(1) : "—";

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/student/teachers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gold transition-colors hover:text-gold-hover"
      >
        <ArrowRight size={14} /> {t("العودة للمعلمين", "Back to teachers")}
      </Link>

      {/* Header card — name, rating, hourly rate */}
      <div className="glass-card p-6">
        <h1 className="text-2xl font-bold text-foreground">{name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                size={14}
                className={i <= Math.round(ratingNum) ? "fill-gold text-gold" : "text-card-border"}
                aria-hidden="true"
              />
            ))}
            <span className="ms-1">{rating}</span>
          </div>
          <div className="flex items-center gap-1">
            <BookOpen size={14} className="text-gold" aria-hidden="true" />
            {tp.total_sessions} {t("جلسة مكتملة", "completed sessions")}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gold">{Number(tp.hourly_rate).toFixed(0)}$</span>
            <span className="text-xs">/ {t("ساعة", "hour")}</span>
          </div>
        </div>
      </div>

      {/* Bio */}
      {bio && (
        <div className="glass-card mt-4 p-6">
          <h2 className="mb-3 text-sm font-semibold text-gold">{t("نبذة عن المعلم", "About the teacher")}</h2>
          <p dir={bioDir} className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {bio}
            {usedFallback && (
              <span className="ms-2 rounded border border-white/10 px-1.5 py-0.5 align-middle text-[10px] text-muted/60">
                {lang === "ar" ? "EN" : "AR"}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Specialties */}
      {tp.specialties.length > 0 && (
        <div className="glass-card mt-4 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold">
            <Award size={14} aria-hidden="true" />
            {t("التخصصات", "Specialties")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {tp.specialties.map((s) => (
              <span key={s} className="glass glass-pill px-3 py-1 text-xs text-gold">
                {labelForSpecialty(s)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recitation standards */}
      {tp.recitation_standards.length > 0 && (
        <div className="glass-card mt-4 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold">
            <Mic size={14} aria-hidden="true" />
            {t("روايات القراءة", "Recitation styles")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {[...new Set(tp.recitation_standards)].map((r) => (
              <span key={r} className="glass-badge px-3 py-1 text-xs text-muted">
                {(lang === "ar" ? RIWAYA_AR[r as RecitationStandard] : RIWAYA_EN[r as RecitationStandard]) ?? r}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Availability summary */}
      {availableDays.length > 0 && (
        <div className="glass-card mt-4 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold">
            <CalendarDays size={14} aria-hidden="true" />
            {t("الأيام المتاحة", "Available days")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {availableDays.map((day) => {
              const slots = availabilityByDay.get(day) ?? [];
              const first = slots[0];
              return (
                <span key={day} className="glass glass-pill px-3 py-1 text-xs text-gold" dir="ltr">
                  <span className="me-1">{DAY_AR[day]}</span>
                  {first.start}–{first.end}
                  {slots.length > 1 && <span className="ms-1 text-muted">+{slots.length - 1}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Primary CTA */}
      <div className="mt-6">
        <Link
          href={`/student/bookings/new?teacher=${tp.teacher_id}`}
          className="focus-ring flex w-full items-center justify-center gap-2 rounded-xl glass-gold py-4 text-base font-bold text-white transition-colors"
          aria-label={t(`احجز جلسة مع ${name}`, `Book a session with ${name}`)}
        >
          {t("احجز جلسة", "Book a session")}
        </Link>
      </div>
      <SingleSessionPurchase
        teacherId={tp.teacher_id}
        availability={availability ?? []}
        priceUsd={instantPrice}
        lang={lang}
      />
    </div>
  );
}
