import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { GenderType } from "@/types/database";
import { TeacherList } from "./teacher-list";

export const metadata: Metadata = { title: "المعلمون" };

export interface TeacherData {
  teacher_id: string;
  name: string;
  bio: string | null;
  specialties: string[];
  recitation_standards: string[];
  hourly_rate: number;
  rating_avg: number;
  total_sessions: number;
  gender: GenderType | null;
}

export default async function TeachersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: teachers } = await supabase
    .from("teacher_profiles")
    .select("teacher_id, bio, specialties, recitation_standards, hourly_rate, rating_avg, total_sessions, gender")
    .eq("is_archived", false)
    .eq("is_accepting", true)
    .order("rating_avg", { ascending: false })
    .returns<Omit<TeacherData, "name">[]>();

  const list = teachers ?? [];

  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = list.map((t) => t.teacher_id);
    const { data: profiles } = await supabase
      .from("profiles").select("id, full_name").in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? "معلم"]));
    }
  }

  const teacherData: TeacherData[] = list.map((t) => ({
    ...t,
    name: nameMap[t.teacher_id] ?? "معلم",
  }));

  return <TeacherList teachers={teacherData} />;
}
