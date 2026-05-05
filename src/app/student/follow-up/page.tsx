import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookOpen, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { HomeworkAssignment } from "@/types/database";
import { HomeworkList } from "./homework-list";

export const metadata: Metadata = { title: "متابعاتي" };

export default async function StudentFollowUpPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch student's follow-up assignments
  const { data: assignments } = await supabase
    .from("homework_assignments")
    .select("*")
    .eq("student_id", user.id)
    .order("assigned_at", { ascending: false })
    .returns<HomeworkAssignment[]>();

  // Build name map for teachers
  const teacherIds = [...new Set((assignments ?? []).map(a => a.teacher_id))];
  const nameMap: Record<string, string> = {};
  if (teacherIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", teacherIds)
      .returns<{ id: string; full_name: string | null }[]>();
    for (const p of profiles ?? []) {
      nameMap[p.id] = p.full_name ?? t("معلم", "Teacher");
    }
  }

  // Build a parent-assignment lookup so re-attempts can show the original
  // grade + teacher's notes + completion date. Without this, the existing
  // "Re-assigned — try again" badge is just a label; the student still has
  // to guess why the original attempt was rejected. With it, the student
  // sees the teacher's actual feedback in context with the new attempt.
  const parentIds = [
    ...new Set(
      (assignments ?? [])
        .map(a => a.parent_assignment_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const parentMap: Record<
    string,
    { id: string; status: string; teacher_notes: string | null; completed_at: string | null; title: string }
  > = {};
  if (parentIds.length > 0) {
    const { data: parents } = await supabase
      .from("homework_assignments")
      .select("id, status, teacher_notes, completed_at, title")
      .in("id", parentIds)
      .returns<{ id: string; status: string; teacher_notes: string | null; completed_at: string | null; title: string }[]>();
    for (const p of parents ?? []) {
      parentMap[p.id] = p;
    }
  }

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <BookOpen size={24} className="text-gold" />
        <h1 className="text-xl font-bold">{t("متابعاتي", "My Follow-ups")}</h1>
      </div>

      {!assignments || assignments.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">{t("لا توجد متابعات بعد", "No follow-ups yet")}</p>
          <p className="mt-1 text-sm text-muted/60">
            {t("سيكلّفك معلمك بمتابعات بعد كل جلسة لتثبيت ما تعلمته", "Your teacher will assign follow-ups after each session to lock in what you learned")}
          </p>
        </div>
      ) : (
        <HomeworkList
          assignments={assignments}
          nameMap={nameMap}
          parentMap={parentMap}
          studentId={user.id}
        />
      )}
    </div>
  );
}
