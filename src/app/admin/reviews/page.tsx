import type { Metadata } from "next";
import Link from "next/link";
import { Star, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { ReviewToggle } from "./review-toggle";
import { DeleteReviewButton } from "./delete-review";

export const metadata: Metadata = { title: "المراجعات" };

interface ReviewRow { id: string; student_id: string; teacher_id: string; rating: number; comment: string | null; teacher_reply: string | null; is_public: boolean; created_at: string; }

export default async function AdminReviewsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

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

  // #542: per-teacher average + count, worst-first so quality problems surface.
  const perTeacher = Object.values(
    reviews.reduce<Record<string, { teacherId: string; sum: number; count: number }>>((acc, r) => {
      const a = acc[r.teacher_id] ?? { teacherId: r.teacher_id, sum: 0, count: 0 };
      a.sum += r.rating; a.count += 1; acc[r.teacher_id] = a;
      return acc;
    }, {}),
  )
    .map(a => ({ teacherId: a.teacherId, avg: a.sum / a.count, count: a.count }))
    .sort((x, y) => x.avg - y.avg);

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Star size={24} className="text-gold" /> {t("المراجعات", "Reviews")}</h1>
      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="glass-card rounded-xl p-4 text-center"><p className="text-2xl font-bold text-gold">{reviews.length}</p><p className="text-xs text-muted">{t("إجمالي", "Total")}</p></div>
        <div className="glass-card rounded-xl p-4 text-center"><p className="text-2xl font-bold text-gold">{avgRating}</p><p className="text-xs text-muted">{t("متوسط التقييم", "Avg. Rating")}</p></div>
        <div className="glass-card rounded-xl p-4 text-center"><p className="text-2xl font-bold text-gold">{publicCount}</p><p className="text-xs text-muted">{t("عامة", "Public")}</p></div>
      </div>

      {perTeacher.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-muted">{t("متوسط التقييم لكل معلّم", "Average rating per teacher")}</h2>
          <div className="overflow-x-auto rounded-xl glass-card">
            <table className="w-full text-sm">
              <thead><tr className="glass-thead">
                <th scope="col" className="px-3 py-2 text-start font-medium text-muted">{t("المعلّم", "Teacher")}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium text-muted">{t("المتوسط", "Avg")}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium text-muted">{t("عدد التقييمات", "Ratings")}</th>
              </tr></thead>
              <tbody>
                {perTeacher.map(pt => (
                  <tr key={pt.teacherId} className="border-b border-white/10 last:border-b-0">
                    <td className="px-3 py-2"><Link href={`/admin/users/${pt.teacherId}`} className="hover:text-gold">{nameMap[pt.teacherId] ?? t("معلم", "Teacher")}</Link></td>
                    <td className={`px-3 py-2 font-medium ${pt.avg < 3 ? "text-error" : pt.avg < 4 ? "text-warning" : "text-success"}`}>{pt.avg.toFixed(1)}</td>
                    <td className="px-3 py-2 text-muted">{pt.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reviews.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">{t("لا توجد مراجعات", "No reviews yet")}</p></div>
      ) : (
        <div className="space-y-3">
          {reviews.map(r => (
            <div key={r.id} className="glass-card rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/users/${r.student_id}`} className="font-medium hover:text-gold">{nameMap[r.student_id] ?? t("طالب", "Student")}</Link>
                    <span className="text-xs text-muted">→</span>
                    <Link href={`/admin/users/${r.teacher_id}`} className="text-sm text-muted hover:text-gold">{nameMap[r.teacher_id] ?? t("معلم", "Teacher")}</Link>
                  </div>
                  <div className="mt-1 flex items-center gap-0.5">
                    {[1,2,3,4,5].map(i => <Star key={i} size={12} className={i <= r.rating ? "fill-gold text-gold" : "text-card-border"} />)}
                  </div>
                  {r.comment && <p className="mt-2 text-sm text-muted">{r.comment}</p>}
                  {r.teacher_reply && <p className="mt-1 text-sm text-gold/70">{t("رد المعلم", "Teacher reply")}: {r.teacher_reply}</p>}
                  <p className="mt-1 text-xs text-muted">{new Date(r.created_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <ReviewToggle reviewId={r.id} isPublic={r.is_public} />
                  <DeleteReviewButton reviewId={r.id} studentName={nameMap[r.student_id] ?? "—"} teacherName={nameMap[r.teacher_id] ?? "—"} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
