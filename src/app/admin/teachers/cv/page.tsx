import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buildNameMap } from "@/lib/admin/name-map";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "مراجعة السير الذاتية" };

interface PendingCv {
  teacher_id: string;
  cv_submitted_at: string | null;
}

export default async function AdminCvQueuePage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const supabase = await createClient();

  const { data: pending } = await supabase
    .from("teacher_profiles")
    .select("teacher_id, cv_submitted_at")
    .eq("cv_status", "pending_review")
    .order("cv_submitted_at", { ascending: true })
    .returns<PendingCv[]>();

  const list = pending ?? [];

  const nameMap = await buildNameMap(
    supabase,
    list.map((it) => it.teacher_id),
    t("معلم", "Teacher"),
  );

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileText size={24} className="text-gold" />
          {t("مراجعة السير الذاتية", "CV Review Queue")}
          {lang === "ar" && <span className="text-sm font-normal text-muted">Pending CVs</span>}
        </h1>
        <Link
          href="/admin/teachers"
          className="text-sm text-gold hover:text-gold-light"
        >
          {t("العودة للمعلمين", "Back to Teachers")}
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{t("لا توجد سير ذاتية بانتظار المراجعة", "No CVs awaiting review")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((cv) => (
            <Link
              key={cv.teacher_id}
              href={`/admin/teachers/cv/${cv.teacher_id}`}
              className="block glass-card p-5 transition-colors hover:border-gold/30"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {nameMap[cv.teacher_id] ?? t("معلم", "Teacher")}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {t("تاريخ الإرسال", "Submitted")}:{" "}
                    {cv.cv_submitted_at
                      ? new Date(cv.cv_submitted_at).toLocaleDateString(locale)
                      : t("غير محدد", "Unspecified")}
                  </p>
                </div>
                <span className="glass-badge border-warning/30 bg-warning/10 text-warning">
                  {t("بانتظار المراجعة", "Pending Review")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
