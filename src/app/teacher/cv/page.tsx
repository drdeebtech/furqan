import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CvForm } from "./cv-form";

export const metadata: Metadata = { title: "السيرة الذاتية" };

interface TeacherProfile {
  bio: string | null;
  specialties: string[] | null;
  languages: string[] | null;
  recitation_standards: string[] | null;
  intro_video_url: string | null;
  cv_status: string | null;
  cv_submitted_at: string | null;
  cv_reviewed_at: string | null;
  cv_rejection_reason: string | null;
}

const STATUS_MAP: Record<string, { label: string; classes: string }> = {
  draft: {
    label: "مسودة",
    classes:
      "border-gray-500/30 bg-gray-500/10 text-gray-400",
  },
  pending_review: {
    label: "بانتظار المراجعة",
    classes:
      "border-amber-500/30 bg-amber-500/10 text-amber-400",
  },
  approved: {
    label: "مقبولة",
    classes:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  },
  rejected: {
    label: "مرفوضة",
    classes:
      "border-red-500/30 bg-red-500/10 text-red-400",
  },
};

export default async function TeacherCvPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("teacher_profiles")
    .select(
      "bio, specialties, languages, recitation_standards, intro_video_url, cv_status, cv_submitted_at, cv_reviewed_at, cv_rejection_reason",
    )
    .eq("teacher_id", user.id)
    .single<TeacherProfile>();

  if (!profile) redirect("/teacher/dashboard");

  const status = profile.cv_status ?? "draft";
  const badge = STATUS_MAP[status] ?? STATUS_MAP.draft;

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileText size={24} className="text-gold" />
          السيرة الذاتية
          <span className="text-sm font-normal text-muted">Teacher CV</span>
        </h1>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${badge.classes}`}
        >
          {badge.label}
        </span>
      </div>

      {status === "rejected" && profile.cv_rejection_reason && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          <p className="mb-1 font-semibold">سبب الرفض:</p>
          <p>{profile.cv_rejection_reason}</p>
        </div>
      )}

      {status === "approved" && (
        <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-400">
          تمت الموافقة على سيرتك الذاتية — يمكنك الآن استقبال الطلاب
        </div>
      )}

      <CvForm
        bio={profile.bio ?? ""}
        specialties={profile.specialties ?? []}
        languages={profile.languages ?? []}
        recitationStandards={profile.recitation_standards ?? []}
        introVideoUrl={profile.intro_video_url ?? ""}
        cvStatus={status}
      />
    </div>
  );
}
