import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookOpen, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { HomeworkAssignment } from "@/types/database";
import { HomeworkList } from "./homework-list";

export const metadata: Metadata = { title: "الواجبات" };

export default async function StudentHomeworkPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch student's homework assignments
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
      nameMap[p.id] = p.full_name ?? "معلم";
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <BookOpen size={24} className="text-gold" />
        <h1 className="text-xl font-bold">واجباتي</h1>
        <span className="text-sm text-muted">My Homework</span>
      </div>

      {!assignments || assignments.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">لا توجد واجبات بعد</p>
          <p className="mt-1 text-sm text-muted/60">
            سيكلّفك معلمك بالواجبات بعد كل جلسة
          </p>
        </div>
      ) : (
        <HomeworkList assignments={assignments} nameMap={nameMap} />
      )}
    </div>
  );
}
