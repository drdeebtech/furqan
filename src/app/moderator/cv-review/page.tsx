import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "مراجعة السير الذاتية" };

interface PendingCv { teacher_id: string; cv_submitted_at: string | null; bio: string | null; }

export default async function ModeratorCvReviewPage() {
  const { t, dir, lang } = await getT();
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
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? t("معلم", "Teacher")]));
  }

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <FileText size={24} className="text-gold" /> {t("مراجعة السير الذاتية", "CV Review")}
        {list.length > 0 && (
          <span className="glass-badge rounded-full px-3 py-1 text-sm text-amber-400">{list.length}</span>
        )}
      </h1>

      {list.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{t("لا توجد سير ذاتية بانتظار المراجعة", "No CVs pending review")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(cv => (
            <Link key={cv.teacher_id} href={`/moderator/cv-review/${cv.teacher_id}`}
              className="glass-card block rounded-xl p-4 transition-colors hover:border-gold/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{nameMap[cv.teacher_id] ?? t("معلم", "Teacher")}</p>
                  <p className="text-xs text-muted">{cv.bio ? cv.bio.slice(0, 80) + "..." : t("بدون نبذة", "No bio")}</p>
                </div>
                <div className="text-left">
                  <span className="glass-badge rounded-full px-2 py-0.5 text-xs text-amber-400">{t("بانتظار المراجعة", "Pending Review")}</span>
                  {cv.cv_submitted_at && <p className="mt-1 text-xs text-muted">{new Date(cv.cv_submitted_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</p>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
