import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { TeachersContent } from "./content";

export const metadata: Metadata = {
  title: "معلمونا — معلمو القرآن المعتمدون",
  description: "معلمو أكاديمية فرقان حاصلون على الإجازة من كبار العلماء. خريجو الأزهر. متاح معلمات للأخوات.",
  alternates: { canonical: "https://furqan.today/teachers-page" },
};

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
  if (teachers.length > 0) {
    const ids = teachers.map(t => t.teacher_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
  }

  const teacherData = teachers.map(t => ({
    id: t.teacher_id,
    name: nameMap[t.teacher_id] ?? "—",
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
