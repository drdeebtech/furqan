import { createAdminClient } from "@/lib/supabase/admin";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";

/**
 * Structured parent-facing session report.
 * The `narrative_paragraph` field is the AI-swappable slot: today it's a
 * templated summary built from session facts; Sprint 8 will replace it with a
 * Claude-generated warm narrative using the same context.
 */
export interface SessionNarrative {
  session_id: string;
  subject: string;
  student_name: string;
  teacher_name: string;
  session_date_ar: string;
  duration_min: number;
  session_type_ar: string;
  narrative_paragraph: string;
  teaching_points: string[];
  homework: { title: string; description: string | null } | null;
  evaluation: { overall_score: number | null; strengths: string | null; weaknesses: string | null } | null;
  next_steps: string;
  generated_via: "template" | "ai";
}

interface SessionRow {
  id: string;
  booking_id: string;
  started_at: string | null;
  ended_at: string | null;
  actual_duration: number | null;
  post_session_notes: string | null;
  homework: string | null;
}

interface BookingRow {
  student_id: string;
  teacher_id: string;
  scheduled_at: string;
  duration_min: number;
  session_type: SessionType;
}

interface HomeworkRow {
  title: string;
  description: string | null;
}

interface EvaluationRow {
  overall_score: number | null;
  strengths: string | null;
  weaknesses: string | null;
}

interface ProfileRow {
  full_name: string | null;
}

/**
 * Build a structured session narrative for the parent.
 * Returns null if the session isn't found or is still in progress.
 */
export async function buildSessionNarrative(sessionId: string): Promise<SessionNarrative | null> {
  const supabase = createAdminClient();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id, started_at, ended_at, actual_duration, post_session_notes, homework")
    .eq("id", sessionId)
    .single<SessionRow>();
  if (!session || !session.ended_at) return null;

  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id, scheduled_at, duration_min, session_type")
    .eq("id", session.booking_id)
    .single<BookingRow>();
  if (!booking) return null;

  const [studentRes, teacherRes, homeworkRes, evalRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", booking.student_id).single<ProfileRow>(),
    supabase.from("profiles").select("full_name").eq("id", booking.teacher_id).single<ProfileRow>(),
    supabase
      .from("homework_assignments")
      .select("title, description")
      .eq("session_id", sessionId)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle<HomeworkRow>(),
    supabase
      .from("session_evaluations")
      .select("overall_score, strengths, weaknesses")
      .eq("student_id", booking.student_id)
      .eq("teacher_id", booking.teacher_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<EvaluationRow>(),
  ]);

  const studentName = studentRes.data?.full_name ?? "الطالب/ة";
  const teacherName = teacherRes.data?.full_name ?? "المعلم/ة";
  const sessionDate = new Date(session.ended_at).toLocaleDateString("ar", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const sessionTypeAr = SESSION_TYPE_AR[booking.session_type] ?? booking.session_type;
  const duration = session.actual_duration ?? booking.duration_min;

  // AI-swappable slot: templated narrative today, Claude-generated tomorrow.
  const notesSnippet = session.post_session_notes?.trim();
  const narrativeParagraph = notesSnippet
    ? `في جلسة ${sessionTypeAr} اليوم مع ${teacherName}، عمل ${studentName} على ما يلي: ${notesSnippet}`
    : `أكمل ${studentName} جلسة ${sessionTypeAr} مع ${teacherName} بنجاح. استمرار الحضور والمواظبة من أهم عوامل التقدم.`;

  const teachingPoints: string[] = [];
  if (notesSnippet) teachingPoints.push(notesSnippet);
  if (evalRes.data?.strengths) teachingPoints.push(`نقاط القوة: ${evalRes.data.strengths}`);
  if (evalRes.data?.weaknesses) teachingPoints.push(`ما يحتاج متابعة: ${evalRes.data.weaknesses}`);

  const nextSteps = homeworkRes.data?.title
    ? `الواجب القادم: ${homeworkRes.data.title}. نشجعكم على المراجعة معه/ها قبل الجلسة القادمة.`
    : "ننصح بمراجعة ما تم اليوم قبل الجلسة القادمة لترسيخ التعلم.";

  return {
    session_id: session.id,
    subject: `ملخص جلسة ${studentName} — ${sessionDate}`,
    student_name: studentName,
    teacher_name: teacherName,
    session_date_ar: sessionDate,
    duration_min: duration,
    session_type_ar: sessionTypeAr,
    narrative_paragraph: narrativeParagraph,
    teaching_points: teachingPoints,
    homework: homeworkRes.data ?? null,
    evaluation: evalRes.data ?? null,
    next_steps: nextSteps,
    generated_via: "template",
  };
}
