import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { HomeworkAssignment } from "@/types/database";
import { HomeworkList } from "./homework-list";
import { AddFollowUpDialog, type DialogBooking } from "./add-follow-up-dialog";

export const metadata: Metadata = { title: "المتابعة" };

export default async function TeacherFollowUpPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify teacher role
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["admin", "teacher"].includes((profile as { role: string }).role)) {
    redirect("/login");
  }

  // Fetch all follow-ups created by this teacher
  const { data: assignments } = await supabase
    .from("homework_assignments")
    .select("*")
    .eq("teacher_id", user.id)
    .order("assigned_at", { ascending: false })
    .returns<HomeworkAssignment[]>();

  // Build name map for students (used by the list and the picker dialog)
  const studentIds = [...new Set((assignments ?? []).map(a => a.student_id))];
  const nameMap: Record<string, string> = {};
  if (studentIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", studentIds)
      .returns<{ id: string; full_name: string | null }[]>();
    for (const p of profiles ?? []) {
      nameMap[p.id] = p.full_name ?? t("طالب", "Student");
    }
  }

  // Confirmed bookings for the picker. We dedupe by student_id so a teacher
  // with five sessions for the same student sees one row, not five — the row
  // labels the active booking pair, the form scopes the assignment to that
  // booking. Most-recent confirmed booking wins per student.
  const { data: confirmedBookings } = await supabase
    .from("bookings")
    .select("id, student_id, scheduled_at")
    .eq("teacher_id", user.id)
    .eq("status", "confirmed")
    .order("scheduled_at", { ascending: false })
    .returns<{ id: string; student_id: string; scheduled_at: string }[]>();

  const seenStudent = new Set<string>();
  const dialogBookings: DialogBooking[] = [];
  for (const b of confirmedBookings ?? []) {
    if (seenStudent.has(b.student_id)) continue;
    seenStudent.add(b.student_id);
    // Backfill student names that weren't already in the assignments-driven map
    if (!nameMap[b.student_id]) {
      const { data: p } = await supabase
        .from("profiles").select("full_name").eq("id", b.student_id)
        .single<{ full_name: string | null }>();
      nameMap[b.student_id] = p?.full_name ?? t("طالب", "Student");
    }
    dialogBookings.push({
      bookingId: b.id,
      studentId: b.student_id,
      studentName: nameMap[b.student_id],
    });
  }

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BookOpen size={24} className="text-gold" />
          <h1 className="text-xl font-bold">{t("المتابعة", "Follow-up")}</h1>
        </div>
        <AddFollowUpDialog bookings={dialogBookings} />
      </div>

      {!assignments || assignments.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">{t("لا توجد متابعات بعد", "No follow-ups yet")}</p>
          <p className="mt-1 text-sm text-muted/60">
            {t(
              "اضغط \"+ إضافة متابعة\" لإسناد أول متابعة، أو أنشئ متابعة من صفحة الجلسة بعد انتهائها",
              "Click \"+ Add follow-up\" to assign the first one, or create one from the session page after it ends",
            )}
          </p>
          <Link href="/teacher/sessions" className="mt-4 inline-block text-sm text-gold hover:text-gold-hover">
            {t("الذهاب للجلسات ←", "Go to Sessions →")}
          </Link>
        </div>
      ) : (
        <HomeworkList assignments={assignments} nameMap={nameMap} />
      )}
    </div>
  );
}
