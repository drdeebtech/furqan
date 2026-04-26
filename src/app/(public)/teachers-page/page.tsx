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

  let nameMap: Record<string, string> = {};
  let avatarMap: Record<string, string | null> = {};
  if (teachers.length > 0) {
    const ids = teachers.map(t => t.teacher_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null; avatar_url: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
      avatarMap = Object.fromEntries(profiles.map(p => [p.id, p.avatar_url ?? null]));
    }
  }

  const teacherData = teachers.map(t => ({
    id: t.teacher_id,
    name: nameMap[t.teacher_id] ?? "—",
    avatarUrl: avatarMap[t.teacher_id] ?? null,
    bio: t.bio,
    specialties: t.specialties,
    recitationStandards: t.recitation_standards,
    hourlyRate: Number(t.hourly_rate),
    ratingAvg: Number(t.rating_avg),
    totalSessions: t.total_sessions,
    gender: t.gender,
  }));

  return <TeachersContent teachers={teacherData} />;
}
