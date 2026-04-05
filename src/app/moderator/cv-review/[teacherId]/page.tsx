import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CvReviewActions } from "./review-actions";

export const metadata: Metadata = { title: "مراجعة السيرة الذاتية" };

interface TeacherCv {
  teacher_id: string; bio: string | null; specialties: string[]; recitation_standards: string[];
  languages: string[]; hourly_rate: number; intro_video_url: string | null;
  cv_status: string; cv_submitted_at: string | null; cv_rejection_reason: string | null;
}

export default async function ModeratorCvDetailPage({ params }: { params: Promise<{ teacherId: string }> }) {
  const { teacherId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: teacher } = await supabase.from("teacher_profiles")
    .select("teacher_id, bio, specialties, recitation_standards, languages, hourly_rate, intro_video_url, cv_status, cv_submitted_at, cv_rejection_reason")
    .eq("teacher_id", teacherId).single().then(r => ({ data: r.data as TeacherCv | null }));

  if (!teacher) notFound();

  const { data: profile } = await supabase.from("profiles").select("full_name, country, phone")
    .eq("id", teacherId).single<{ full_name: string | null; country: string | null; phone: string | null }>();

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/moderator/cv-review" className="rounded-lg border border-card-border p-2 text-muted transition-colors hover:bg-surface-alt">
          <ArrowRight size={16} />
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileText size={24} className="text-gold" /> مراجعة السيرة الذاتية
        </h1>
      </div>

      <div className="rounded-2xl border border-card-border bg-card p-6">
        <div className="mb-4 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-display text-xl font-bold text-gold">
            {(profile?.full_name ?? "م").charAt(0)}
          </div>
          <div>
            <h2 className="text-lg font-bold">{profile?.full_name ?? "معلم"}</h2>
            <p className="text-sm text-muted">{profile?.country ?? ""}{profile?.phone ? ` · ${profile.phone}` : ""}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-gold">النبذة</p>
            <p className="mt-1 text-sm">{teacher.bio || "—"}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-gold">التخصصات</p>
              <div className="mt-1 flex flex-wrap gap-1">{teacher.specialties.map(s => (
                <span key={s} className="rounded-full border border-card-border bg-surface px-2 py-0.5 text-xs">{s}</span>
              ))}</div>
            </div>
            <div>
              <p className="text-xs font-medium text-gold">معايير القراءة</p>
              <div className="mt-1 flex flex-wrap gap-1">{teacher.recitation_standards.map(s => (
                <span key={s} className="rounded-full border border-card-border bg-surface px-2 py-0.5 text-xs">{s}</span>
              ))}</div>
            </div>
            <div>
              <p className="text-xs font-medium text-gold">اللغات</p>
              <div className="mt-1 flex flex-wrap gap-1">{teacher.languages.map(s => (
                <span key={s} className="rounded-full border border-card-border bg-surface px-2 py-0.5 text-xs">{s}</span>
              ))}</div>
            </div>
          </div>
          {teacher.intro_video_url && (
            <div>
              <p className="text-xs font-medium text-gold">فيديو تعريفي</p>
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
