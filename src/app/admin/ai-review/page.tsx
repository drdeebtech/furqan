import type { Metadata } from "next";
import { Brain, CheckCircle, XCircle, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { approveReview, rejectReview } from "@/lib/actions/admin-ai-review";
import type { AiOutputReview } from "@/types/database";

export const metadata: Metadata = { title: "AI Output Review" };

export default async function AdminAiReviewPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();

  // Table not yet in generated types (migration pending prod push); cast result after fetch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: pendingRaw } = await db
    .from("ai_output_review")
    .select("*")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true });

  const { data: recentRaw } = await db
    .from("ai_output_review")
    .select("*")
    .neq("status", "pending_review")
    .order("reviewed_at", { ascending: false })
    .limit(20);

  const pending = pendingRaw as AiOutputReview[] | null;
  const recent = recentRaw as AiOutputReview[] | null;

  const rows = pending ?? [];
  const history = recent ?? [];

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Brain size={24} className="text-gold" />
        <h1 className="text-xl font-bold">{t("مراجعة مخرجات الذكاء الاصطناعي", "AI Output Review")}</h1>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="glass-card p-5 text-center">
          <p className="font-display text-2xl font-bold text-warning">{rows.length}</p>
          <p className="text-xs text-muted">{t("في انتظار المراجعة", "Pending Review")}</p>
        </div>
        <div className="glass-card p-5 text-center">
          <p className="font-display text-2xl font-bold text-success">
            {history.filter(r => r.status === "approved").length}
          </p>
          <p className="text-xs text-muted">{t("موافق عليها", "Approved")}</p>
        </div>
        <div className="glass-card p-5 text-center">
          <p className="font-display text-2xl font-bold text-red-400">
            {history.filter(r => r.status === "rejected").length}
          </p>
          <p className="text-xs text-muted">{t("مرفوضة", "Rejected")}</p>
        </div>
      </div>

      {/* Pending items */}
      {rows.length === 0 ? (
        <div className="glass-card p-10 text-center text-muted">
          <CheckCircle size={32} className="mx-auto mb-3 text-success" />
          <p>{t("لا توجد مخرجات في انتظار المراجعة", "No outputs pending review")}</p>
        </div>
      ) : (
        <div className="space-y-4 mb-8">
          <h2 className="font-semibold text-sm text-muted uppercase tracking-wide">
            {t("في انتظار المراجعة", "Pending Review")}
          </h2>
          {rows.map(item => (
            <div key={item.id} className="glass-card p-5 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning">
                    <Clock size={11} />
                    {item.workflow_name}
                  </span>
                  <p className="mt-1 text-xs text-muted">
                    {item.entity_type} · {item.entity_id}
                  </p>
                </div>
                <p className="text-xs text-muted whitespace-nowrap">
                  {new Date(item.created_at).toLocaleDateString()}
                </p>
              </div>

              <div className="rounded-lg bg-white/5 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                {item.output_text}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                {/* Approve */}
                <form action={approveReview}>
                  <input type="hidden" name="id" value={item.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-4 py-2 text-sm font-semibold text-success hover:bg-success/20 transition-colors"
                  >
                    <CheckCircle size={14} />
                    {t("موافقة", "Approve")}
                  </button>
                </form>

                {/* Reject */}
                <form action={rejectReview} className="flex gap-2 flex-1">
                  <input type="hidden" name="id" value={item.id} />
                  <input
                    type="text"
                    name="rejection_reason"
                    required
                    placeholder={t("سبب الرفض...", "Rejection reason...")}
                    maxLength={500}
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-red-400"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
                  >
                    <XCircle size={14} />
                    {t("رفض", "Reject")}
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent history */}
      {history.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm text-muted uppercase tracking-wide">
            {t("السجل الأخير", "Recent History")}
          </h2>
          {history.map(item => (
            <div key={item.id} className="glass-card p-4 flex items-start gap-3">
              {item.status === "approved" ? (
                <CheckCircle size={16} className="mt-0.5 shrink-0 text-success" />
              ) : (
                <XCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{item.workflow_name}</span>
                  <span className="text-xs text-muted">{item.entity_type}</span>
                </div>
                <p className="mt-1 text-xs text-muted line-clamp-2">{item.output_text}</p>
                {item.rejection_reason && (
                  <p className="mt-1 text-xs text-red-400">
                    {t("سبب الرفض:", "Reason:")} {item.rejection_reason}
                  </p>
                )}
              </div>
              <p className="text-xs text-muted whitespace-nowrap">
                {item.reviewed_at ? new Date(item.reviewed_at).toLocaleDateString() : "—"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
