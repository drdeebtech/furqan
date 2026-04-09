import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { HomeworkAssignment } from "@/types/database";
import { HomeworkList } from "./homework-list";

export const metadata: Metadata = { title: "الواجبات" };

export default async function TeacherHomeworkPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify teacher role
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["admin", "moderator", "teacher"].includes((profile as { role: string }).role)) {
    redirect("/login");
  }

  // Fetch all homework created by this teacher
  const { data: assignments } = await supabase
    .from("homework_assignments")
    .select("*")
    .eq("teacher_id", user.id)
    .order("assigned_at", { ascending: false })
    .returns<HomeworkAssignment[]>();

  // Build name map for students
  const studentIds = [...new Set((assignments ?? []).map(a => a.student_id))];
  const nameMap: Record<string, string> = {};
  if (studentIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", studentIds)
      .returns<{ id: string; full_name: string | null }[]>();
    for (const p of profiles ?? []) {
      nameMap[p.id] = p.full_name ?? "طالب";
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <BookOpen size={24} className="text-gold" />
        <h1 className="text-xl font-bold">الواجبات</h1>
        <span className="text-sm text-muted">Homework</span>
      </div>

      {!assignments || assignments.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">لا توجد واجبات بعد</p>
          <p className="mt-1 text-sm text-muted/60">
            يمكنك إنشاء واجب بعد إكمال أي جلسة من صفحة الجلسات
          </p>
          <Link href="/teacher/sessions" className="mt-4 inline-block text-sm text-gold hover:text-gold-hover">
            الذهاب للجلسات ←
          </Link>
        </div>
      ) : (
        <HomeworkList assignments={assignments} nameMap={nameMap} />
      )}
    </div>
  );
}
