import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { TeachersContent } from "./content";

export const metadata: Metadata = {
  title: "معلمونا — معلمو القرآن المعتمدون",
  description: "معلمو أكاديمية فرقان حاصلون على الإجازة من كبار العلماء. خريجو الأزهر. متاح معلمات للأخوات.",
  alternates: { canonical: "https://furqan.today/teachers-page" },
};

// ISR — public teacher list changes when an admin approves/archives a
// teacher. 5-minute cache turns the slowest public page (~890ms avg in
// the k6 smoke test) into a CDN edge response (~50ms). Admin mutations
// call revalidatePath('/teachers-page') for immediate invalidation; the
// 5-min ceiling is the worst-case staleness when the cache hasn't been
// touched.
export const revalidate = 300;

export default async function TeachersPage() {
  const supabase = await createClient();

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

  // Filter out anyone whose role isn't actually 'teacher'. teacher_profiles
  // rows can exist for admins/etc when an account doubles up (e.g. an admin
  // who also onboarded as a teacher for testing). The public list should
  // only show actual teachers — profile.role is the source of truth.
  let nameMap: Record<string, string> = {};
  let nameArMap: Record<string, string | null> = {};
  let avatarMap: Record<string, string | null> = {};
  let validTeacherIds = new Set<string>();
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
  }

  // Bilingual label maps from DB (teacher_specialties + teacher_recitations).
  // We pass these to the client so the card can render Arabic/English without
  // hardcoded constants. Falls back to the raw key if the DB row was deleted.
  // Cast: tables added in v15_008, src/types/database.ts not yet regenerated.
  type LabelRow = { key: string; label_ar: string; label_en: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [specRes, recRes] = await Promise.all([
    sb.from("teacher_specialties").select("key, label_ar, label_en").eq("is_active", true) as Promise<{ data: LabelRow[] | null }>,
    sb.from("teacher_recitations").select("key, label_ar, label_en").eq("is_active", true) as Promise<{ data: LabelRow[] | null }>,
  ]);
  const specialtyLabels = Object.fromEntries((specRes.data ?? []).map((r: LabelRow) => [r.key, { ar: r.label_ar, en: r.label_en }]));
  const recitationLabels = Object.fromEntries((recRes.data ?? []).map((r: LabelRow) => [r.key, { ar: r.label_ar, en: r.label_en }]));

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
      totalSessions: t.total_sessions,
      gender: t.gender,
    }));

  return <TeachersContent teachers={teacherData} specialtyLabels={specialtyLabels} recitationLabels={recitationLabels} />;
}
