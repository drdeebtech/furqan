import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ArrowLeft, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { CvReviewActions } from "./review-actions";

export const metadata: Metadata = { title: "مراجعة السيرة الذاتية" };

interface TeacherCv {
  teacher_id: string; bio: string | null; bio_en: string | null; specialties: string[]; recitation_standards: string[];
  languages: string[]; hourly_rate: number; intro_video_url: string | null;
  cv_status: string; cv_submitted_at: string | null; cv_rejection_reason: string | null;
}

export default async function ModeratorCvDetailPage({ params }: { params: Promise<{ teacherId: string }> }) {
  const { teacherId } = await params;
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: teacher } = await supabase.from("teacher_profiles")
    .select("teacher_id, bio, bio_en, specialties, recitation_standards, languages, hourly_rate, intro_video_url, cv_status, cv_submitted_at, cv_rejection_reason")
    .eq("teacher_id", teacherId).single().then(r => ({ data: r.data as TeacherCv | null }));

  if (!teacher) notFound();

  const { data: profile } = await supabase.from("profiles").select("full_name, country, phone")
    .eq("id", teacherId).single<{ full_name: string | null; country: string | null; phone: string | null }>();

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/moderator/cv-review"
          aria-label={t("رجوع", "Back")}
          className="glass rounded-lg p-2 text-muted transition-colors hover:bg-white/10"
        >
          {dir === "rtl" ? <ArrowRight size={16} aria-hidden="true" /> : <ArrowLeft size={16} aria-hidden="true" />}
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileText size={24} className="text-gold" /> {t("مراجعة السيرة الذاتية", "CV Review")}
        </h1>
      </div>

      <div className="glass-card p-6">
        <div className="mb-4 flex items-center gap-4">
          <div className="glass flex h-14 w-14 items-center justify-center rounded-full font-display text-xl font-bold text-gold">
            {(profile?.full_name ?? "T").charAt(0)}
          </div>
          <div>
            <h2 className="text-lg font-bold">{profile?.full_name ?? t("معلم", "Teacher")}</h2>
            <p className="text-sm text-muted">{profile?.country ?? ""}{profile?.phone ? ` · ${profile.phone}` : ""}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-gold">{t("النبذة", "Bio")}</p>
            <p dir="rtl" className="mt-1 text-sm">{teacher.bio || "—"}</p>
            <p className="mt-3 text-xs font-medium text-gold">{t("النبذة (إنجليزي)", "Bio (English)")}</p>
            <p dir="ltr" className="mt-1 text-sm text-left">{teacher.bio_en || "—"}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-gold">{t("التخصصات", "Specialties")}</p>
              <div className="mt-1 flex flex-wrap gap-1">{teacher.specialties.map(s => (
                <span key={s} className="glass-badge rounded-full px-2 py-0.5 text-xs">{s}</span>
              ))}</div>
            </div>
            <div>
              <p className="text-xs font-medium text-gold">{t("معايير القراءة", "Recitation Standards")}</p>
              <div className="mt-1 flex flex-wrap gap-1">{teacher.recitation_standards.map(s => (
                <span key={s} className="glass-badge rounded-full px-2 py-0.5 text-xs">{s}</span>
              ))}</div>
            </div>
            <div>
              <p className="text-xs font-medium text-gold">{t("اللغات", "Languages")}</p>
              <div className="mt-1 flex flex-wrap gap-1">{teacher.languages.map(s => (
                <span key={s} className="glass-badge rounded-full px-2 py-0.5 text-xs">{s}</span>
              ))}</div>
            </div>
          </div>
          {teacher.intro_video_url && (
            <div>
              <p className="text-xs font-medium text-gold">{t("فيديو تعريفي", "Intro Video")}</p>
              <a href={teacher.intro_video_url} target="_blank" rel="noopener noreferrer" className="mt-1 text-sm text-gold hover:text-gold-light">{teacher.intro_video_url}</a>
            </div>
          )}
        </div>
      </div>

      {teacher.cv_status === "pending_review" && (
        <CvReviewActions teacherId={teacherId} />
      )}
    </div>
  );
}
