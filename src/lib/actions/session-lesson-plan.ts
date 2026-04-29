"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

// JSONB shape stored in sessions.lesson_plan
export interface LessonPlanCheckpoint {
  id: string;
  label: string;
  completed_at: string | null;
}

export interface LessonPlan {
  checkpoints: LessonPlanCheckpoint[];
  last_updated_at: string;
}

interface ActionResult {
  ok: boolean;
  error?: string;
}

// Verify the caller is the teacher who owns this session (or admin/mod).
async function authorizeTeacherForSession(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const { data: session } = await supabase
    .from("sessions")
    .select("booking:bookings(teacher_id)")
    .eq("id", sessionId)
    .single<{ booking: { teacher_id: string } | null }>();
  if (!session?.booking) return { ok: false, error: "الجلسة غير موجودة" };

  if (session.booking.teacher_id === user.id) return { ok: true };

  // Allow admins/moderators
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (profile && (profile.role === "admin" || profile.role === "moderator")) {
    return { ok: true };
  }
  return { ok: false, error: "غير مصرح" };
}

function genId(): string {
  return crypto.randomUUID();
}

// ─── setLessonPlan ──────────────────────────────────────────────────────────
// Initialize or replace the entire plan. Used at session start when the
// teacher pastes a list of checkpoint labels.

export async function setLessonPlan(sessionId: string, labels: string[]): Promise<ActionResult> {
  const auth = await authorizeTeacherForSession(sessionId);
  if (!auth.ok) return auth;

  const cleaned = labels.map((s) => s.trim()).filter(Boolean).slice(0, 30);
  if (cleaned.length === 0) {
    return clearLessonPlan(sessionId);
  }

  const plan: LessonPlan = {
    checkpoints: cleaned.map((label) => ({ id: genId(), label, completed_at: null })),
    last_updated_at: new Date().toISOString(),
  };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sessions")
    .update({ lesson_plan: plan as unknown } as TableUpdate<"sessions">)
    .eq("id", sessionId);
  if (error) {
    logError("setLessonPlan failed", error, { tag: "lesson-plan", sessionId });
    return { ok: false, error: error.message };
  }
  revalidatePath(`/teacher/sessions/${sessionId}`);
  revalidatePath(`/student/sessions/${sessionId}`);
  return { ok: true };
}

// ─── toggleCheckpoint ───────────────────────────────────────────────────────
// Tick or untick a single checkpoint by id. Recomputes last_updated_at.

export async function toggleCheckpoint(
  sessionId: string,
  checkpointId: string,
  completed: boolean,
): Promise<ActionResult> {
  const auth = await authorizeTeacherForSession(sessionId);
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("sessions")
    .select("lesson_plan")
    .eq("id", sessionId)
    .single<{ lesson_plan: LessonPlan | null }>();
  const plan = row?.lesson_plan;
  if (!plan?.checkpoints) {
    return { ok: false, error: "لا توجد خطة درس" };
  }
  const idx = plan.checkpoints.findIndex((c) => c.id === checkpointId);
  if (idx === -1) return { ok: false, error: "نقطة التحقق غير موجودة" };

  const updated: LessonPlan = {
    ...plan,
    checkpoints: plan.checkpoints.map((c) =>
      c.id === checkpointId
        ? { ...c, completed_at: completed ? new Date().toISOString() : null }
        : c,
    ),
    last_updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("sessions")
    .update({ lesson_plan: updated as unknown } as TableUpdate<"sessions">)
    .eq("id", sessionId);
  if (error) {
    logError("toggleCheckpoint failed", error, { tag: "lesson-plan", sessionId });
    return { ok: false, error: error.message };
  }
  revalidatePath(`/teacher/sessions/${sessionId}`);
  revalidatePath(`/student/sessions/${sessionId}`);
  return { ok: true };
}

// ─── clearLessonPlan ────────────────────────────────────────────────────────

export async function clearLessonPlan(sessionId: string): Promise<ActionResult> {
  const auth = await authorizeTeacherForSession(sessionId);
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { error } = await supabase
    .from("sessions")
    .update({ lesson_plan: null } satisfies TableUpdate<"sessions">)
    .eq("id", sessionId);
  if (error) {
    logError("clearLessonPlan failed", error, { tag: "lesson-plan", sessionId });
    return { ok: false, error: error.message };
  }
  revalidatePath(`/teacher/sessions/${sessionId}`);
  revalidatePath(`/student/sessions/${sessionId}`);
  return { ok: true };
}

