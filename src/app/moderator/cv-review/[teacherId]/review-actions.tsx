"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, XCircle } from "lucide-react";
import { approveCv, rejectCv } from "./actions";

export function CvReviewActions({ teacherId }: { teacherId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    startTransition(async () => {
      const result = await approveCv(teacherId);
      if (result.error) setError(result.error);
      else router.push("/moderator/cv-review");
    });
  }

  async function handleReject() {
    startTransition(async () => {
      const result = await rejectCv(teacherId, reason);
      if (result.error) setError(result.error);
      else router.push("/moderator/cv-review");
    });
  }

  return (
    <div className="mt-6 rounded-2xl border border-card-border bg-card p-6">
      {error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
      )}

      {showReject ? (
        <div className="space-y-3">
          <label className="block text-sm font-medium">سبب الرفض</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none"
            placeholder="اكتب سبب الرفض..."
          />
          <div className="flex gap-3">
            <button
              onClick={handleReject}
              disabled={isPending || !reason.trim()}
              className="flex items-center gap-2 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              <XCircle size={16} /> تأكيد الرفض
            </button>
            <button
              onClick={() => setShowReject(false)}
              disabled={isPending}
              className="text-sm text-muted hover:text-foreground"
            >
              إلغاء
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={handleApprove}
            disabled={isPending}
            className="flex items-center gap-2 rounded bg-emerald-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCircle size={16} /> قبول السيرة الذاتية
          </button>
          <button
            onClick={() => setShowReject(true)}
            disabled={isPending}
            className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-6 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            <XCircle size={16} /> رفض
          </button>
        </div>
      )}
    </div>
  );
}
