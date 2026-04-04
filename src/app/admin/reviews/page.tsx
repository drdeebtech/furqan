import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Star, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ReviewToggle } from "./review-toggle";

export const metadata: Metadata = { title: "التقييمات" };

interface ReviewRow { id: string; student_id: string; teacher_id: string; rating: number; comment: string | null; teacher_reply: string | null; is_public: boolean; created_at: string; }

export default async function AdminReviewsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("reviews").select("id, student_id, teacher_id, rating, comment, teacher_reply, is_public, created_at")
    .order("created_at", { ascending: false }).returns<ReviewRow[]>();
  const reviews = data ?? [];

  const allIds = [...new Set([...reviews.map(r => r.student_id), ...reviews.map(r => r.teacher_id)])];
  let nameMap: Record<string, string> = {};
  if (allIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", allIds).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
  }

  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : "—";
  const publicCount = reviews.filter(r => r.is_public).length;

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Star size={24} className="text-gold" /> التقييمات</h1>
      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-card-border bg-card p-4 text-center"><p className="text-2xl font-bold text-gold">{reviews.length}</p><p className="text-xs text-muted">إجمالي</p></div>
        <div className="rounded-xl border border-card-border bg-card p-4 text-center"><p className="text-2xl font-bold text-gold">{avgRating}</p><p className="text-xs text-muted">متوسط التقييم</p></div>
        <div className="rounded-xl border border-card-border bg-card p-4 text-center"><p className="text-2xl font-bold text-gold">{publicCount}</p><p className="text-xs text-muted">عامة</p></div>
      </div>
      {reviews.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">لا توجد تقييمات</p></div>
      ) : (
        <div className="space-y-3">
          {reviews.map(r => (
            <div key={r.id} className="rounded-xl border border-card-border bg-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{nameMap[r.student_id] ?? "طالب"}</p>
                    <span className="text-xs text-muted">→ {nameMap[r.teacher_id] ?? "معلم"}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-0.5">
                    {[1,2,3,4,5].map(i => <Star key={i} size={12} className={i <= r.rating ? "fill-gold text-gold" : "text-card-border"} />)}
                  </div>
                  {r.comment && <p className="mt-2 text-sm text-muted">{r.comment}</p>}
                  {r.teacher_reply && <p className="mt-1 text-sm text-gold/70">رد المعلم: {r.teacher_reply}</p>}
                  <p className="mt-1 text-xs text-muted">{new Date(r.created_at).toLocaleDateString("ar-SA")}</p>
                </div>
                <ReviewToggle reviewId={r.id} isPublic={r.is_public} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
