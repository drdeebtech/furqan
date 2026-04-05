import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "مراجعة السير الذاتية" };

interface PendingCv { teacher_id: string; cv_submitted_at: string | null; bio: string | null; }

export default async function ModeratorCvReviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: pending } = await supabase.from("teacher_profiles")
    .select("teacher_id, cv_submitted_at, bio")
    .eq("cv_status", "pending_review")
    .order("cv_submitted_at", { ascending: true })
    .returns<PendingCv[]>();

  const list = pending ?? [];

  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = list.map(t => t.teacher_id);
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "معلم"]));
  }

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <FileText size={24} className="text-gold" /> مراجعة السير الذاتية
        {list.length > 0 && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-sm text-amber-400">{list.length}</span>
        )}
      </h1>

      {list.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد سير ذاتية بانتظار المراجعة</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(cv => (
            <Link key={cv.teacher_id} href={`/moderator/cv-review/${cv.teacher_id}`}
              className="block rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{nameMap[cv.teacher_id] ?? "معلم"}</p>
                  <p className="text-xs text-muted">{cv.bio ? cv.bio.slice(0, 80) + "..." : "بدون نبذة"}</p>
                </div>
                <div className="text-left">
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">بانتظار المراجعة</span>
                  {cv.cv_submitted_at && <p className="mt-1 text-xs text-muted">{new Date(cv.cv_submitted_at).toLocaleDateString("ar-SA")}</p>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
