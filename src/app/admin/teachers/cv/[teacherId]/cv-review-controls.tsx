"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { approveCv, rejectCv } from "./actions";

export function CvReviewControls({ teacherId }: { teacherId: string }) {
  const router = useRouter();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [approvePending, startApprove] = useTransition();
  const [rejectPending, startReject] = useTransition();

  const handleApprove = () => {
    startApprove(async () => {
      const result = await approveCv(teacherId);
      if (result.error) {
        setError(result.error);
      } else {
        router.push("/admin/teachers/cv");
      }
    });
  };

  const handleReject = () => {
    if (!reason.trim()) {
      setError("يجب ذكر سبب الرفض");
      return;
    }
    startReject(async () => {
      const result = await rejectCv(teacherId, reason);
      if (result.error) {
        setError(result.error);
      } else {
        router.push("/admin/teachers/cv");
      }
    });
  };

  return (
    <div className="glass-card p-6">
      <h3 className="mb-4 text-lg font-semibold">
        إجراء المراجعة
        <span className="mr-2 text-sm font-normal text-muted">
          Review Action
        </span>
      </h3>

      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      {!showRejectForm ? (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleApprove}
            disabled={approvePending}
            className="flex items-center gap-2 glass-success glass-pill px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {approvePending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Check size={16} />
            )}
            قبول السيرة الذاتية
          </button>

          <button
            onClick={() => setShowRejectForm(true)}
            className="flex items-center gap-2 glass-danger glass-pill px-4 py-2 text-sm font-medium transition-colors"
          >
            <X size={16} />
            رفض
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="reject_reason"
              className="mb-1 block text-sm font-medium"
            >
              سبب الرفض
              <span className="mr-2 text-xs text-muted">Rejection Reason</span>
            </label>
            <textarea
              id="reject_reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="اكتب سبب رفض السيرة الذاتية..."
              className="w-full rounded-xl glass-input px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleReject}
              disabled={rejectPending}
              className="flex items-center gap-2 glass-danger glass-pill px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {rejectPending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <X size={16} />
              )}
              تأكيد الرفض
            </button>

            <button
              onClick={() => {
                setShowRejectForm(false);
                setReason("");
                setError(null);
              }}
              className="glass glass-pill px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
