import type { Metadata } from "next";
import { GraduationCap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { GraderClient } from "./grader-client";

export const metadata: Metadata = {
  title: "تقييم المتابعات · Bulk Follow-up Grader",
};

interface PendingHomeworkRow {
  id: string;
  title: string;
  description: string | null;
  homework_type: string;
  surah_number: number | null;
  ayah_start: number | null;
  ayah_end: number | null;
  pages_count: number | null;
  created_at: string;
  due_at: string | null;
  student_id: string;
  teacher_id: string;
  booking_id: string;
}

interface ProfileNameRow {
  id: string;
  full_name: string;
}

export default async function AdminHomeworkGradePage() {
  const { t, dir } = await getT();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("homework_assignments")
    .select("id, title, description, homework_type, surah_number, ayah_start, ayah_end, pages_count, created_at, due_at, student_id, teacher_id, booking_id")
    .eq("status", "student_ready")
    .order("created_at", { ascending: true })
    .limit(30)
    .returns<PendingHomeworkRow[]>();

  const queue = rows ?? [];

  const ids = new Set<string>();
  for (const r of queue) {
    ids.add(r.student_id);
    ids.add(r.teacher_id);
  }

  const { data: profiles } =
    ids.size > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", Array.from(ids))
          .returns<ProfileNameRow[]>()
      : { data: [] as ProfileNameRow[] };

  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) nameMap[p.id] = p.full_name;

  const itemsForClient = queue.map((h) => ({
    id: h.id,
    title: h.title,
    description: h.description,
    homeworkType: h.homework_type,
    surah: h.surah_number,
    ayahStart: h.ayah_start,
    ayahEnd: h.ayah_end,
    pagesCount: h.pages_count,
    createdAt: h.created_at,
    dueAt: h.due_at,
    studentName: nameMap[h.student_id] ?? "—",
    teacherName: nameMap[h.teacher_id] ?? "—",
  }));

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <GraduationCap size={24} className="text-gold" />
          <h1 className="text-xl font-bold">{t("قائمة المتابعات بانتظار التقييم", "Follow-ups Awaiting Grading")}</h1>
        </div>
        <p className="mt-2 text-sm text-muted">
          {t(
            "تقييم بالنيابة عن المعلمين عندما يتأخرون. كل إجراء يُسجَّل في سجل المراجعة.",
            "Grade on behalf of teachers when they're delayed. Every action is recorded in the audit log.",
          )}
        </p>
      </header>

      <GraderClient items={itemsForClient} />
    </div>
  );
}
