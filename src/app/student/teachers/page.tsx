import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { Skeleton } from "@/components/shared/skeleton";
import { getActiveTeacherSpecialties } from "@/lib/site-content/queries";
import { TeacherList } from "./teacher-list";
import type { TeacherData } from "./types";

export const metadata: Metadata = { title: "المعلمون" };

export default async function TeachersPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Pull the student's most-recent recitation_standard alongside the
  // teachers list so each teacher card can highlight matching standards.
  // Without this, the student has no signal that "Hafs an Asim" on a
  // teacher card is the standard they're already studying.
  const [teachersRes, studentStandardRes] = await Promise.all([
    supabase
      .from("teacher_profiles")
      .select("teacher_id, bio, bio_en, specialties, recitation_standards, hourly_rate, rating_avg, total_sessions, gender")
      .eq("is_archived", false)
      .eq("is_accepting", true)
      .eq("cv_status", "approved")
      .order("rating_avg", { ascending: false })
      .returns<Omit<TeacherData, "name">[]>(),
    supabase
      .from("student_progress")
      .select("recitation_standard")
      .eq("student_id", user.id)
      .not("recitation_standard", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ recitation_standard: string | null }>(),
  ]);
  const teachers = teachersRes.data;
  const studentStandard = studentStandardRes.data?.recitation_standard ?? null;

  const list = teachers ?? [];

  let nameMap: Record<string, { name: string; nameAr: string | null }> = {};
  if (list.length > 0) {
    const ids = list.map((t) => t.teacher_id);
    const { data: profiles } = await supabase
      .from("profiles").select("id, full_name, full_name_ar").in("id", ids)
      .returns<{ id: string; full_name: string | null; full_name_ar: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(
        profiles.map((p) => [
          p.id,
          { name: p.full_name ?? t("معلم", "Teacher"), nameAr: p.full_name_ar },
        ]),
      );
    }
  }

  const specialtyLabels = await getActiveTeacherSpecialties();

  const teacherData: TeacherData[] = list.map((r) => ({
    ...r,
    name: nameMap[r.teacher_id]?.name ?? t("معلم", "Teacher"),
    nameAr: nameMap[r.teacher_id]?.nameAr ?? null,
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
      <TeacherList
        teachers={teacherData}
        specialtyLabels={specialtyLabels}
        studentStandard={studentStandard}
      />
    </Suspense>
  );
}
