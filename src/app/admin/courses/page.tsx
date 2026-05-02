import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, GraduationCap, Inbox, Plus, User } from "lucide-react";
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
  pending_review: "bg-warning/30 text-warning",
  published: "bg-success/20 text-success",
  archived: "bg-muted/30 text-muted",
  rejected: "bg-error/20 text-error",
};

interface SearchParams {
  status?: string;
  ownership?: string;
}

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { status, ownership } = await searchParams;
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
      "id, slug, title_ar, title_en, status, pricing_type, price_cents, currency, lesson_count_cached, enrollment_count_cached, teacher_id, ownership, updated_at, published_at",
    )
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (status && ["draft", "pending_review", "published", "archived", "rejected"].includes(status)) {
    q = q.eq("status", status);
  }
  if (ownership === "platform" || ownership === "teacher") {
    q = q.eq("ownership", ownership);
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
      | "ownership"
      | "updated_at"
      | "published_at"
    >[]
  >();

  // Resolve teacher names — only for teacher-owned rows. Platform-owned rows
  // have null teacher_id and don't need a profile lookup.
  const teacherIds = [
    ...new Set(
      (courses ?? [])
        .map((c) => c.teacher_id)
        .filter((id): id is string => id !== null),
    ),
  ];
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

  const ownershipTabs = [
    { value: "", label: t("الكل", "All") },
    { value: "platform", label: t("المنصة", "Platform") },
    { value: "teacher", label: t("معلمون", "Teachers") },
  ];

  const buildHref = (s: string, o: string) => {
    const search = new URLSearchParams();
    if (s) search.set("status", s);
    if (o) search.set("ownership", o);
    const qs = search.toString();
    return qs ? `/admin/courses?${qs}` : "/admin/courses";
  };

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <GraduationCap size={24} className="text-gold" aria-hidden="true" />
          <h1 className="font-display text-xl font-bold sm:text-2xl">{t("الدورات المسجلة", "Recorded Courses")}</h1>
        </div>
        <Link
          href="/admin/courses/new"
          className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-background transition hover:bg-gold-hover focus-ring"
        >
          <Plus size={16} aria-hidden="true" />
          {t("دورة جديدة", "New course")}
        </Link>
      </div>

      <div className="mb-2 flex flex-wrap gap-2">
        {filterTabs.map((f) => {
          const active = (status ?? "") === f.value;
          return (
            <Link
              key={`status-${f.value}`}
              href={buildHref(f.value, ownership ?? "")}
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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{t("الملكية:", "Ownership:")}</span>
        {ownershipTabs.map((o) => {
          const active = (ownership ?? "") === o.value;
          return (
            <Link
              key={`ownership-${o.value}`}
              href={buildHref(status ?? "", o.value)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                active
                  ? "bg-gold text-background"
                  : "border bg-white/30 hover:bg-white/50 dark:bg-white/5 dark:hover:bg-white/10"
              }`}
            >
              {o.label}
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
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                  {c.ownership === "platform" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-gold">
                      <Building2 size={12} aria-hidden="true" />
                      {t("المنصة", "Platform")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <User size={12} aria-hidden="true" />
                      {(c.teacher_id && nameMap[c.teacher_id]) || "—"}
                    </span>
                  )}
                  <span>·</span>
                  <span>
                    {c.lesson_count_cached ?? 0} {t("درس", "lessons")}
                  </span>
                  {c.pricing_type === "free" ? (
                    <span className="text-success">{t("مجاني", "Free")}</span>
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
