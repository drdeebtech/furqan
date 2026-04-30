import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GraduationCap, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { Course } from "@/types/database";

export const metadata: Metadata = { title: "مراجعة الدورات" };

const STATUS_LABEL_AR: Record<string, string> = {
  draft: "مسودة",
  pending_review: "بانتظار المراجعة",
  published: "منشورة",
  archived: "مؤرشفة",
  rejected: "مرفوضة",
};
const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted/20 text-muted",
  pending_review: "bg-amber-500/30 text-amber-800",
  published: "bg-emerald-500/20 text-emerald-700",
  archived: "bg-muted/30 text-muted",
  rejected: "bg-red-500/20 text-red-700",
};

interface SearchParams {
  status?: string;
}

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { status } = await searchParams;
  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || !["admin", "moderator"].includes(profile.role)) {
    redirect("/login");
  }

  let q = supabase
    .from("courses")
    .select(
      "id, slug, title_ar, title_en, status, pricing_type, price_cents, currency, lesson_count_cached, enrollment_count_cached, teacher_id, updated_at, published_at",
    )
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (status && ["draft", "pending_review", "published", "archived", "rejected"].includes(status)) {
    q = q.eq("status", status);
  }

  const { data: courses } = await q.returns<
    Pick<
      Course,
      | "id"
      | "slug"
      | "title_ar"
      | "title_en"
      | "status"
      | "pricing_type"
      | "price_cents"
      | "currency"
      | "lesson_count_cached"
      | "enrollment_count_cached"
      | "teacher_id"
      | "updated_at"
      | "published_at"
    >[]
  >();

  // Resolve teacher names
  const teacherIds = [...new Set((courses ?? []).map((c) => c.teacher_id))];
  const nameMap: Record<string, string> = {};
  if (teacherIds.length > 0) {
    const { data: teachers } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", teacherIds)
      .returns<{ id: string; full_name: string | null }[]>();
    for (const tc of teachers ?? []) {
      nameMap[tc.id] = tc.full_name ?? "—";
    }
  }

  const filterTabs = [
    { value: "", label: t("الكل", "All") },
    { value: "pending_review", label: t("بانتظار المراجعة", "Pending review") },
    { value: "published", label: t("منشورة", "Published") },
    { value: "rejected", label: t("مرفوضة", "Rejected") },
    { value: "archived", label: t("مؤرشفة", "Archived") },
  ];

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <GraduationCap size={24} className="text-gold" />
        <h1 className="text-xl font-bold">{t("مراجعة الدورات", "Course Review")}</h1>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {filterTabs.map((f) => {
          const active = (status ?? "") === f.value;
          return (
            <Link
              key={f.value}
              href={f.value ? `/admin/courses?status=${f.value}` : "/admin/courses"}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                active
                  ? "bg-gold text-background"
                  : "border bg-white/30 hover:bg-white/50 dark:bg-white/5 dark:hover:bg-white/10"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {!courses || courses.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">{t("لا توجد دورات", "No courses")}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/admin/courses/${c.id}`}
              className="glass-card flex items-start justify-between gap-4 p-5 transition hover:bg-white/40 dark:hover:bg-white/5"
            >
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="text-base font-semibold">{c.title_ar}</h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[c.status] ?? STATUS_BADGE.draft}`}
                  >
                    {STATUS_LABEL_AR[c.status] ?? c.status}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
                  <span>{nameMap[c.teacher_id] ?? "—"}</span>
                  <span>·</span>
                  <span>
                    {c.lesson_count_cached ?? 0} {t("درس", "lessons")}
                  </span>
                  {c.pricing_type === "free" ? (
                    <span className="text-emerald-600">{t("مجاني", "Free")}</span>
                  ) : (
                    <span className="text-gold">
                      {(c.price_cents / 100).toFixed(2)} {c.currency}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
