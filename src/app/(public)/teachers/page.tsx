import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { addCacheTag } from "@vercel/functions";
import { createAdminClient } from "@/lib/supabase/admin";
import { TeachersContent } from "./content";

// Cache the public teacher listing (and reference labels) at the
// Next.js Data Cache layer with a 5-min revalidate window. The
// (public) layout reads cookies (auth-aware nav), which forces every
// child route into dynamic rendering and disables full CDN-edge ISR —
// so we can't reach `cache-control: public` on the response. But we
// can still amortize the 4-query database burn across all requests.
// admin mutations call revalidateTag('teachers-public') for instant
// freshness; the 300s ceiling is just the worst-case staleness floor.
const getPublicTeachers = unstable_cache(
  async () => {
    // admin: public anonymous read of teacher listings (issue #523)
    const supabase = createAdminClient();

    const { data: teacherProfiles } = await supabase
      .from("teacher_profiles")
      .select("teacher_id, bio, specialties, recitation_standards, hourly_rate, rating_avg, total_sessions, gender")
      .eq("is_archived", false)
      .eq("is_accepting", true)
      .eq("cv_status", "approved")
      .order("rating_avg", { ascending: false })
      .returns<{
        teacher_id: string;
        bio: string | null;
        specialties: string[];
        recitation_standards: string[];
        hourly_rate: number;
        rating_avg: number;
        total_sessions: number;
        gender: string | null;
      }[]>();

    const teachers = teacherProfiles ?? [];

    let nameMap: Record<string, string> = {};
    let nameArMap: Record<string, string | null> = {};
    let avatarMap: Record<string, string | null> = {};
    let validTeacherIds = new Set<string>();
    // Per-teacher review count — gates the public rating display (#542: show
    // the aggregate only once a teacher has ≥3 ratings, so a single early
    // review can't define a teacher's public score). rating_avg itself is
    // maintained by the t_update_teacher_rating trigger.
    const ratingCountMap: Record<string, number> = {};
    if (teachers.length > 0) {
      const ids = teachers.map(t => t.teacher_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, full_name_ar, avatar_url, role")
        .in("id", ids)
        .eq("role", "teacher")
        .returns<{ id: string; full_name: string | null; full_name_ar: string | null; avatar_url: string | null; role: string }[]>();
      if (profiles) {
        validTeacherIds = new Set(profiles.map(p => p.id));
        nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
        nameArMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name_ar ?? null]));
        avatarMap = Object.fromEntries(profiles.map(p => [p.id, p.avatar_url ?? null]));
      }
      const { data: revRows } = await supabase
        .from("reviews")
        .select("teacher_id")
        .in("teacher_id", ids)
        .returns<{ teacher_id: string }[]>();
      for (const r of revRows ?? []) ratingCountMap[r.teacher_id] = (ratingCountMap[r.teacher_id] ?? 0) + 1;
    }

    const [specRes, recRes] = await Promise.all([
      supabase.from("teacher_specialties").select("key, label_ar, label_en").eq("is_active", true),
      supabase.from("teacher_recitations").select("key, label_ar, label_en").eq("is_active", true),
    ]);
    const specialtyLabels = Object.fromEntries((specRes.data ?? []).map((r) => [r.key, { ar: r.label_ar, en: r.label_en }]));
    const recitationLabels = Object.fromEntries((recRes.data ?? []).map((r) => [r.key, { ar: r.label_ar, en: r.label_en }]));

    const teacherData = teachers
      .filter(t => validTeacherIds.has(t.teacher_id))
      .map(t => ({
        id: t.teacher_id,
        name: nameMap[t.teacher_id] ?? "—",
        nameAr: nameArMap[t.teacher_id] ?? null,
        avatarUrl: avatarMap[t.teacher_id] ?? null,
        bio: t.bio,
        specialties: t.specialties,
        recitationStandards: t.recitation_standards,
        hourlyRate: Number(t.hourly_rate),
        ratingAvg: Number(t.rating_avg),
        ratingCount: ratingCountMap[t.teacher_id] ?? 0,
        totalSessions: t.total_sessions,
        gender: t.gender,
      }))
      // #542: don't let a hidden rating influence ranking. The SQL `order by
      // rating_avg` would float a teacher with one 5★ review above a veteran
      // averaging 4.8 — yet the card hides that score below 3 ratings. So gate
      // the ranking the same way as the display: teachers with ≥3 ratings rank
      // first by rating, everyone else falls back to experience (sessions).
      .sort((a, b) => {
        const aQ = a.ratingCount >= 3;
        const bQ = b.ratingCount >= 3;
        if (aQ !== bQ) return aQ ? -1 : 1;
        if (aQ && bQ) return b.ratingAvg - a.ratingAvg;
        return b.totalSessions - a.totalSessions;
      });

    return { teacherData, specialtyLabels, recitationLabels };
  },
  ["public-teachers-listing"],
  { tags: ["teachers-public"], revalidate: 300 },
);

const TEACHERS_URL = "https://www.furqan.today/teachers";
const TEACHERS_TITLE = "معلمونا — معلمو القرآن المعتمدون";
const TEACHERS_DESC =
  "معلمو أكاديمية فرقان حاصلون على الإجازة من كبار العلماء. خريجو الأزهر. متاح معلمات للأخوات.";

export const metadata: Metadata = {
  title: TEACHERS_TITLE,
  description: TEACHERS_DESC,
  alternates: {
    canonical: TEACHERS_URL,
    languages: {
      ar: `${TEACHERS_URL}?lang=ar`,
      en: `${TEACHERS_URL}?lang=en`,
      "x-default": TEACHERS_URL,
    },
  },
  openGraph: {
    title: TEACHERS_TITLE,
    description: TEACHERS_DESC,
    url: TEACHERS_URL,
    siteName: "فرقان — FURQAN",
    locale: "ar_SA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TEACHERS_TITLE,
    description: TEACHERS_DESC,
  },
};

// ISR — public teacher list changes when an admin approves/archives a
// teacher. 5-minute cache turns the slowest public page (~890ms avg in
// the k6 smoke test) into a CDN edge response (~50ms). Admin mutations
// call revalidatePath('/teachers') for immediate invalidation; the
// 5-min ceiling is the worst-case staleness when the cache hasn't been
// touched.
export const revalidate = 300;

export default async function TeachersPage() {
  // Tag the response so admin mutations targeting invalidateByTag
  // ('teachers-public') can reach the response when the (public)
  // layout is eventually refactored to be cookie-free. Today this
  // call is a soft no-op because the layout's cookies opt the route
  // into dynamic rendering — the data cache below carries the win
  // until the layout fix lands.
  await addCacheTag("teachers-public");

  const { teacherData, specialtyLabels, recitationLabels } = await getPublicTeachers();

  // Person JSON-LD (schema.org ItemList) for the indexed teacher cards. Built from
  // the same data rendered below. No aggregateRating: we have rating_avg but no true
  // rating *count* (total_sessions ≠ review count), and emitting a fabricated count
  // would be misleading structured data. hasCredential reflects the platform's
  // verified positioning (listing is filtered to cv_status='approved' teachers).
  const namedTeachers = teacherData.filter((tch) => tch.name && tch.name !== "—");
  const teachersJsonLd =
    namedTeachers.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: namedTeachers.map((tch, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: {
              "@type": "Person",
              name: tch.name,
              ...(tch.nameAr ? { alternateName: tch.nameAr } : {}),
              ...(tch.bio ? { description: tch.bio } : {}),
              ...(tch.avatarUrl ? { image: tch.avatarUrl } : {}),
              jobTitle: "Quran Teacher",
              worksFor: { "@type": "Organization", name: "FURQAN Academy", url: "https://www.furqan.today" },
              hasCredential: { "@type": "EducationalOccupationalCredential", credentialCategory: "Ijazah" },
              ...(tch.specialties?.length
                ? { knowsAbout: tch.specialties.map((k) => specialtyLabels[k]?.en ?? k) }
                : {}),
            },
          })),
        }
      : null;

  return (
    <>
      {teachersJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(teachersJsonLd) }}
        />
      )}
      <TeachersContent teachers={teacherData} specialtyLabels={specialtyLabels} recitationLabels={recitationLabels} />
    </>
  );
}
