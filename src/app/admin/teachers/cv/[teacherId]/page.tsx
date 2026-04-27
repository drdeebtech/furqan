import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { CvReviewControls } from "./cv-review-controls";
import { CvEditForm } from "./cv-edit-form";
import { getAllTeacherPicklists } from "@/lib/site-content/queries";

export const metadata: Metadata = { title: "مراجعة السيرة الذاتية" };

interface TeacherCv {
  teacher_id: string;
  bio: string | null;
  bio_en: string | null;
  specialties: string[] | null;
  languages: string[] | null;
  recitation_standards: string[] | null;
  intro_video_url: string | null;
  cv_status: string | null;
  cv_submitted_at: string | null;
}

export default async function AdminCvReviewPage({
  params,
}: {
  params: Promise<{ teacherId: string }>;
}) {
  const { teacherId } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar" : "en-US";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileRes, nameRowRes, picklists] = await Promise.all([
    supabase
      .from("teacher_profiles")
      .select(
        "teacher_id, bio, bio_en, specialties, languages, recitation_standards, intro_video_url, cv_status, cv_submitted_at",
      )
      .eq("teacher_id", teacherId)
      .single<TeacherCv>(),
    supabase.from("profiles").select("full_name").eq("id", teacherId).single<{ full_name: string | null }>(),
    getAllTeacherPicklists(),
  ]);
  const profile = profileRes.data;

  if (!profile) redirect("/admin/teachers/cv");

  const teacherName = nameRowRes.data?.full_name ?? t("معلم", "Teacher");

  const statusLabel =
    profile.cv_status === "approved"
      ? t("معتمد", "Approved")
      : profile.cv_status === "pending_review"
      ? t("قيد المراجعة", "Pending review")
      : profile.cv_status === "rejected"
      ? t("مرفوض", "Rejected")
      : t("مسودة", "Draft");

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileText size={24} className="text-gold" />
          {t("مراجعة سيرة", "Reviewing CV of")} {teacherName}
        </h1>
        <Link
          href="/admin/teachers/cv"
          className="text-sm text-gold hover:text-gold-light"
        >
          {t("العودة للقائمة", "Back to List")}
        </Link>
      </div>

      {/* Status + submission meta */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 glass-card p-4 text-xs text-muted">
        <span className="text-foreground">
          {t("الحالة", "Status")}: <span className="text-gold">{statusLabel}</span>
        </span>
        <span>
          {t("تاريخ الإرسال", "Submitted")}:{" "}
          {profile.cv_submitted_at
            ? new Date(profile.cv_submitted_at).toLocaleDateString(locale, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : t("غير محدد", "Unspecified")}
        </span>
      </div>

      {/* Edit form */}
      <div className="mb-6">
        <CvEditForm
          teacherId={teacherId}
          bio={profile.bio ?? ""}
          bioEn={profile.bio_en ?? ""}
          specialties={profile.specialties ?? []}
          languages={profile.languages ?? []}
          recitationStandards={profile.recitation_standards ?? []}
          introVideoUrl={profile.intro_video_url ?? ""}
          picklists={picklists}
        />
      </div>

      {/* Review Controls */}
      {profile.cv_status === "pending_review" && (
        <CvReviewControls teacherId={teacherId} />
      )}

      {profile.cv_status !== "pending_review" && (
        <div className="glass-card rounded-xl p-4 text-center text-sm text-muted">
          {profile.cv_status === "approved"
            ? t("هذه السيرة الذاتية تمت الموافقة عليها بالفعل.", "This CV has already been approved.")
            : t("هذه السيرة الذاتية تمت مراجعتها بالفعل.", "This CV has already been reviewed.")}
        </div>
      )}
    </div>
  );
}
