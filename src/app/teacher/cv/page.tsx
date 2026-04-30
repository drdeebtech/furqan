import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { CvForm } from "./cv-form";
import { MyIjazas } from "./my-ijazas";
import { getAllTeacherPicklists } from "@/lib/site-content/queries";
import { Award } from "lucide-react";

export const metadata: Metadata = { title: "السيرة الذاتية" };

interface TeacherProfile {
  bio: string | null;
  bio_en: string | null;
  specialties: string[] | null;
  languages: string[] | null;
  recitation_standards: string[] | null;
  intro_video_url: string | null;
  cv_status: string | null;
  cv_submitted_at: string | null;
  cv_reviewed_at: string | null;
  cv_rejection_reason: string | null;
}

const STATUS_MAP: Record<string, { ar: string; en: string; classes: string }> = {
  draft: {
    ar: "مسودة",
    en: "Draft",
    classes:
      "border-gray-500/30 bg-gray-500/10 text-gray-400",
  },
  pending_review: {
    ar: "بانتظار المراجعة",
    en: "Pending Review",
    classes:
      "border-warning/30 bg-warning/10 text-warning",
  },
  approved: {
    ar: "مقبولة",
    en: "Approved",
    classes:
      "border-success/30 bg-success/10 text-success",
  },
  rejected: {
    ar: "مرفوضة",
    en: "Rejected",
    classes:
      "border-error/30 bg-error/10 text-red-400",
  },
};

export default async function TeacherCvPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileRes, accountRes, picklists, ijazasRes] = await Promise.all([
    supabase
      .from("teacher_profiles")
      .select(
        "bio, bio_en, specialties, languages, recitation_standards, intro_video_url, cv_status, cv_submitted_at, cv_reviewed_at, cv_rejection_reason",
      )
      .eq("teacher_id", user.id)
      .single<TeacherProfile>(),
    supabase
      .from("profiles")
      .select("avatar_url, full_name")
      .eq("id", user.id)
      .single<{ avatar_url: string | null; full_name: string | null }>(),
    getAllTeacherPicklists(),
    supabase
      .from("teacher_ijaza")
      .select("id, riwaya, chain_text, granted_by, granted_at, document_url, verified_by, verified_at")
      .eq("teacher_id", user.id)
      .order("created_at", { ascending: false })
      .returns<{
        id: string; riwaya: string; chain_text: string;
        granted_by: string | null; granted_at: string | null; document_url: string | null;
        verified_by: string | null; verified_at: string | null;
      }[]>(),
  ]);
  const ijazas = ijazasRes.data ?? [];

  const profile = profileRes.data;
  if (!profile) redirect("/teacher/dashboard");

  const avatarUrl = accountRes.data?.avatar_url ?? null;
  const fullName = accountRes.data?.full_name ?? null;

  const status = profile.cv_status ?? "draft";
  const badge = STATUS_MAP[status] ?? STATUS_MAP.draft;

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileText size={24} className="text-gold" />
          {t("السيرة الذاتية", "Teacher CV")}
        </h1>
        <span
          className={`glass-badge rounded-full px-2 py-0.5 text-xs ${badge.classes}`}
        >
          {lang === "ar" ? badge.ar : badge.en}
        </span>
      </div>

      {status === "rejected" && profile.cv_rejection_reason && (
        <div className="mb-6 rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-red-400">
          <p className="mb-1 font-semibold">{t("سبب الرفض", "Rejection reason")}:</p>
          <p>{profile.cv_rejection_reason}</p>
        </div>
      )}

      {status === "approved" && (
        <div className="mb-6 rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success">
          {t("تمت الموافقة على سيرتك الذاتية — يمكنك الآن استقبال الطلاب", "Your CV is approved — you can now accept students")}
        </div>
      )}

      <CvForm
        bio={profile.bio ?? ""}
        bioEn={profile.bio_en ?? ""}
        specialties={profile.specialties ?? []}
        languages={profile.languages ?? []}
        recitationStandards={profile.recitation_standards ?? []}
        introVideoUrl={profile.intro_video_url ?? ""}
        cvStatus={status}
        avatarUrl={avatarUrl}
        fullName={fullName}
        picklists={picklists}
      />

      <div className="glass-card mt-6 p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
          <Award size={18} className="text-gold" aria-hidden="true" />
          {t("الإجازات", "Ijazat")}
          <span className="text-xs font-normal text-muted">({ijazas.length})</span>
        </h2>
        <p className="mb-4 text-xs text-muted">
          {t(
            "أضف الإجازات التي حصلت عليها وستراجعها الإدارة قبل أن تظهر في ملفك العام. الإجازات الموثقة لا يمكن تعديلها من هنا.",
            "Submit ijazat you've earned. Admin reviews each one before it appears on your public profile. Verified ijazat can't be edited here.",
          )}
        </p>
        <MyIjazas ijazas={ijazas} />
      </div>
    </div>
  );
}
