"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { CvEditForm } from "@/app/admin/teachers/cv/[teacherId]/cv-edit-form";
import { CvReviewControls } from "@/app/admin/teachers/cv/[teacherId]/cv-review-controls";
import { resetCvToPending } from "@/app/admin/teachers/cv/[teacherId]/actions";

interface CvPanelProps {
  teacherId: string;
  profile: {
    bio: string | null;
    bio_en: string | null;
    specialties: string[] | null;
    languages: string[] | null;
    recitation_standards: string[] | null;
    intro_video_url: string | null;
    cv_status: string | null;
    cv_submitted_at: string | null;
    cv_rejection_reason: string | null;
  };
}

export function CvPanel({ teacherId, profile }: CvPanelProps) {
  const router = useRouter();
  const [resetting, startReset] = useTransition();

  const handleReset = () => {
    if (!confirm("إعادة السيرة الذاتية إلى قيد المراجعة؟")) return;
    startReset(async () => {
      await resetCvToPending(teacherId);
      router.refresh();
    });
  };

  const statusLabel =
    profile.cv_status === "approved"
      ? "معتمد / Approved"
      : profile.cv_status === "pending_review"
      ? "قيد المراجعة / Pending review"
      : profile.cv_status === "rejected"
      ? "مرفوض / Rejected"
      : "مسودة / Draft";

  const canReset = profile.cv_status === "approved" || profile.cv_status === "rejected";

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 glass-card p-4 text-sm">
        <div>
          <span className="text-muted">الحالة / Status:</span>{" "}
          <span className="text-gold">{statusLabel}</span>
        </div>
        {canReset && (
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className="glass-pill flex items-center gap-2 px-4 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
          >
            <RotateCcw size={12} />
            إعادة للمراجعة / Reset to pending
          </button>
        )}
      </div>

      {profile.cv_status === "rejected" && profile.cv_rejection_reason && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm">
          <p className="mb-1 font-medium text-rose-400">سبب الرفض / Rejection reason</p>
          <p className="text-muted">{profile.cv_rejection_reason}</p>
        </div>
      )}

      {/* Edit form */}
      <CvEditForm
        teacherId={teacherId}
        bio={profile.bio ?? ""}
        bioEn={profile.bio_en ?? ""}
        specialties={profile.specialties ?? []}
        languages={profile.languages ?? []}
        recitationStandards={profile.recitation_standards ?? []}
        introVideoUrl={profile.intro_video_url ?? ""}
      />

      {/* Review controls — only for pending_review */}
      {profile.cv_status === "pending_review" && (
        <CvReviewControls teacherId={teacherId} />
      )}
    </div>
  );
}
