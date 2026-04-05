import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "مراجعة السير الذاتية" };

interface PendingCv {
  teacher_id: string;
  cv_submitted_at: string | null;
}

export default async function AdminCvQueuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: pending } = await supabase
    .from("teacher_profiles")
    .select("teacher_id, cv_submitted_at")
    .eq("cv_status", "pending_review")
    .order("cv_submitted_at", { ascending: true })
    .returns<PendingCv[]>();

  const list = pending ?? [];

  // Fetch names
  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = list.map((t) => t.teacher_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles)
      nameMap = Object.fromEntries(
        profiles.map((p) => [p.id, p.full_name ?? "معلم"]),
      );
  }

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileText size={24} className="text-gold" />
          مراجعة السير الذاتية
          <span className="text-sm font-normal text-muted">Pending CVs</span>
        </h1>
        <Link
          href="/admin/teachers"
          className="text-sm text-gold hover:text-gold-light"
        >
          العودة للمعلمين
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد سير ذاتية بانتظار المراجعة</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((cv) => (
            <Link
              key={cv.teacher_id}
              href={`/admin/teachers/cv/${cv.teacher_id}`}
              className="block rounded-2xl border border-card-border bg-card p-5 transition-colors hover:border-gold/30"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {nameMap[cv.teacher_id] ?? "معلم"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    تاريخ الإرسال:{" "}
                    {cv.cv_submitted_at
                      ? new Date(cv.cv_submitted_at).toLocaleDateString(
                          "ar-SA",
                        )
                      : "غير محدد"}
                  </p>
                </div>
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                  بانتظار المراجعة
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
