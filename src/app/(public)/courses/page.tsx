import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap, Inbox, Star } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";
import type { Course } from "@/types/database";

export const metadata: Metadata = {
  title: "الدورات المسجلة",
  description: "تصفح الدورات المسجلة من معلمي فرقان — تجويد، حفظ، إجازة، عربية.",
};

interface SearchParams {
  specialty?: string;
  level?: string;
  language?: string;
  pricing?: string;
  sort?: string;
}

export default async function PublicCoursesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { t, dir } = await getT();
  // Use admin client for SSR public catalog so we don't depend on a session.
  // RLS still permits anon SELECT on status='published'.
  const supabase = createAdminClient();

  let q = supabase
    .from("courses")
    .select(
      "id, slug, title_ar, title_en, description_ar, cover_image_url, pricing_type, price_cents, currency, level, language, specialty, lesson_count_cached, enrollment_count_cached, rating_avg_cached, rating_count_cached, published_at, teacher_id",
    )
    .eq("status", "published")
    .is("deleted_at", null);

  if (sp.specialty) q = q.eq("specialty", sp.specialty);
  if (sp.level) q = q.eq("level", sp.level);
  if (sp.language) q = q.eq("language", sp.language);
  if (sp.pricing === "free") q = q.eq("pricing_type", "free");
  if (sp.pricing === "paid") q = q.eq("pricing_type", "one_time");

  if (sp.sort === "popular") {
    q = q.order("enrollment_count_cached", { ascending: false });
  } else if (sp.sort === "rating") {
    q = q.order("rating_avg_cached", { ascending: false, nullsFirst: false });
  } else {
    q = q.order("published_at", { ascending: false });
  }

  const { data: courses } = await q.limit(50).returns<
    Pick<
      Course,
      | "id"
      | "slug"
      | "title_ar"
      | "title_en"
      | "description_ar"
      | "cover_image_url"
      | "pricing_type"
      | "price_cents"
      | "currency"
      | "level"
      | "language"
      | "specialty"
      | "lesson_count_cached"
      | "enrollment_count_cached"
      | "rating_avg_cached"
      | "rating_count_cached"
      | "published_at"
      | "teacher_id"
    >[]
  >();

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

  const FILTER_TABS = [
    { key: "specialty", value: "", label: t("الكل", "All") },
    { key: "specialty", value: "tajweed", label: t("تجويد", "Tajweed") },
    { key: "specialty", value: "hifz", label: t("حفظ", "Hifz") },
    { key: "specialty", value: "ijazah", label: t("إجازة", "Ijazah") },
    { key: "specialty", value: "arabic", label: t("عربية", "Arabic") },
  ];

  function buildHref(overrides: Record<string, string>) {
    const merged = { ...sp, ...overrides };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `/courses?${qs}` : "/courses";
  }

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <GraduationCap size={28} className="text-gold" />
        <h1 className="text-2xl font-bold">{t("الدورات المسجلة", "Recorded Courses")}</h1>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-muted">
        {t(
          "دورات مسجلة من معلمي فرقان. تعلم في وقتك من شيوخ متمكنين — تجويد، حفظ، إجازة، عربية.",
          "Pre-recorded courses from FURQAN teachers. Learn at your own pace from experienced reciters — Tajweed, Hifz, Ijazah, Arabic.",
        )}
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTER_TABS.map((f) => {
          const active = (sp.specialty ?? "") === f.value;
          return (
            <Link
              key={`${f.key}-${f.value}`}
              href={buildHref({ [f.key]: f.value })}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                active
                  ? "bg-gold text-white"
                  : "border bg-white/30 hover:bg-white/50 dark:bg-white/5 dark:hover:bg-white/10"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
        <span className="mx-1 text-muted">|</span>
        {[
          { value: "", label: t("الكل", "All") },
          { value: "free", label: t("مجاني", "Free") },
          { value: "paid", label: t("مدفوع", "Paid") },
        ].map((p) => {
          const active = (sp.pricing ?? "") === p.value;
          return (
            <Link
              key={`p-${p.value}`}
              href={buildHref({ pricing: p.value })}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                active
                  ? "bg-gold text-white"
                  : "border bg-white/30 hover:bg-white/50 dark:bg-white/5 dark:hover:bg-white/10"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      {!courses || courses.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">
            {t("لا توجد دورات منشورة بعد", "No published courses yet")}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/courses/${c.slug}`}
              className="glass-card overflow-hidden transition hover:scale-[1.01] hover:bg-white/40 dark:hover:bg-white/5"
            >
              {c.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.cover_image_url}
                  alt=""
                  className="aspect-video w-full object-cover"
                />
              ) : (
                <div className="aspect-video w-full bg-gradient-to-br from-gold/30 to-gold/5" />
              )}
              <div className="p-4">
                <h2 className="text-base font-semibold leading-tight">{c.title_ar}</h2>
                {c.description_ar && (
                  <p className="mt-2 line-clamp-2 text-xs text-muted">{c.description_ar}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted">{nameMap[c.teacher_id]}</span>
                  <span className="text-muted">·</span>
                  <span className="text-muted">
                    {c.lesson_count_cached ?? 0} {t("درس", "lessons")}
                  </span>
                  {c.rating_count_cached && c.rating_count_cached > 0 ? (
                    <>
                      <span className="text-muted">·</span>
                      <span className="flex items-center gap-1 text-amber-600">
                        <Star size={11} fill="currentColor" />
                        {c.rating_avg_cached?.toFixed(1)}
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  {c.pricing_type === "free" ? (
                    <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs text-emerald-700">
                      {t("مجاني", "Free")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-gold/20 px-3 py-1 text-xs font-semibold text-gold">
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
