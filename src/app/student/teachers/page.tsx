import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { GenderType } from "@/types/database";
import { Skeleton } from "@/components/shared/skeleton";
import { TeacherList } from "./teacher-list";

export const metadata: Metadata = { title: "المعلمون" };

export interface TeacherData {
  teacher_id: string;
  name: string;
  bio: string | null;
  bio_en: string | null;
  specialties: string[];
  recitation_standards: string[];
  hourly_rate: number;
  rating_avg: number;
  total_sessions: number;
  gender: GenderType | null;
}

export default async function TeachersPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: teachers } = await supabase
    .from("teacher_profiles")
    .select("teacher_id, bio, bio_en, specialties, recitation_standards, hourly_rate, rating_avg, total_sessions, gender")
    .eq("is_archived", false)
    .eq("is_accepting", true)
    .eq("cv_status", "approved")
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
      nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? t("معلم", "Teacher")]));
    }
  }

  const teacherData: TeacherData[] = list.map((r) => ({
    ...r,
    name: nameMap[r.teacher_id] ?? t("معلم", "Teacher"),
  }));

  return (
    <Suspense
      fallback={
        <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
          <Skeleton className="mb-6 h-8 w-40" />
          <Skeleton className="mb-6 h-24 w-full" />
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        </div>
      }
    >
      <TeacherList teachers={teacherData} />
    </Suspense>
  );
}
