import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { CvReviewControls } from "./cv-review-controls";

export const metadata: Metadata = { title: "مراجعة السيرة الذاتية" };

interface TeacherCv {
  teacher_id: string;
  bio: string | null;
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
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("teacher_profiles")
    .select(
      "teacher_id, bio, specialties, languages, recitation_standards, intro_video_url, cv_status, cv_submitted_at",
    )
    .eq("teacher_id", teacherId)
    .single<TeacherCv>();

  if (!profile) redirect("/admin/teachers/cv");

  // Get teacher name
  const { data: nameRow } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", teacherId)
    .single<{ full_name: string | null }>();
  const teacherName = nameRow?.full_name ?? t("معلم", "Teacher");

  const renderList = (items: string[] | null) => {
    if (!items || items.length === 0)
      return <span className="text-muted">{t("غير محدد", "Unspecified")}</span>;
    return (
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item}
            className="glass glass-pill px-3 py-1 text-xs text-gold"
          >
            {item}
          </span>
        ))}
      </div>
    );
  };

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

      {/* CV Details */}
      <div className="mb-6 space-y-5 glass-card p-6">
        {/* Bio */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">
            {t("نبذة تعريفية", "Bio")}
          </h3>
          <p className="whitespace-pre-wrap text-foreground">
            {profile.bio || (
              <span className="text-muted">{t("لم يتم إضافة نبذة", "No bio added")}</span>
            )}
          </p>
        </div>

        {/* Specialties */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">
            {t("التخصصات", "Specialties")}
          </h3>
          {renderList(profile.specialties)}
        </div>

        {/* Languages */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">
            {t("اللغات", "Languages")}
          </h3>
          {renderList(profile.languages)}
        </div>

        {/* Recitation Standards */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">
            {t("معايير القراءة", "Recitation Standards")}
          </h3>
          {renderList(profile.recitation_standards)}
        </div>

        {/* Intro Video */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">
            {t("رابط فيديو تعريفي", "Intro Video")}
          </h3>
          {profile.intro_video_url ? (
            <a
              href={profile.intro_video_url}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="text-sm text-gold hover:text-gold-light"
            >
              {profile.intro_video_url}
            </a>
          ) : (
            <span className="text-muted">{t("لم يتم إضافة فيديو", "No video added")}</span>
          )}
        </div>

        {/* Submitted date */}
        <div className="border-t border-white/10 pt-4 text-xs text-muted">
          {t("تاريخ الإرسال", "Submitted")}:{" "}
          {profile.cv_submitted_at
            ? new Date(profile.cv_submitted_at).toLocaleDateString(locale, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : t("غير محدد", "Unspecified")}
        </div>
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
