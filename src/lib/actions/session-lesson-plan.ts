"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction, notFoundOrInfra } from "@/lib/actions/loud";
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

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

// Logged-in user only — session ownership is checked inside the handler so
// the preflight stays cheap and shared across all three wraps below.
async function loggedInPreflight(): Promise<{ actorId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مسجل الدخول");
  return { actorId: user.id };
}

async function ensureCallerOwnsSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
  userId: string,
) {
  const { data: session, error: sessionErr } = await supabase
    .from("sessions")
    // Explicit FK hint disambiguates the sessions ↔ bookings relationship —
    // PostgREST raises PGRST201 without it because bookings.session_id has
    // both an M:1 FK and a 1:1 unique-constraint shape.
    .select("booking:bookings!bookings_session_id_fkey(teacher_id)")
    .eq("id", sessionId)
    .single<{ booking: { teacher_id: string } | null }>();
  if (sessionErr || !session?.booking) {
    throw notFoundOrInfra(sessionErr, "الجلسة غير موجودة");
  }
  if (session.booking.teacher_id === userId) return;

  // Allow admins
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single<{ role: string }>();
  if (profileErr) throw notFoundOrInfra(profileErr, "غير مصرح");
  if (profile?.role !== "admin") throw new UserError("غير مصرح");
}

function genId(): string {
  return crypto.randomUUID();
}

// ─── setLessonPlan ──────────────────────────────────────────────────────────

type SetLessonPlanInput = { sessionId: string; labels: string[] };

const setLessonPlanBase = loudAction<SetLessonPlanInput, { message: string }>({
  name: "session.lesson-plan.set",
  severity: "info",
  audit: {
    table: "sessions",
    recordId: (i) => i.sessionId,
    action: "UPDATE",
    reasonPrefix: "teacher set lesson plan",
  },
  preflight: loggedInPreflight,
  handler: async ({ sessionId, labels }, { actorId }) => {
    const supabase = await createClient();
    await ensureCallerOwnsSession(supabase, sessionId, actorId!);

    const cleaned = labels.map((s) => s.trim()).filter(Boolean).slice(0, 30);

    // Empty list = clear the plan. Inlined here (rather than re-calling the
    // wrapped clearLessonPlan) so the audit row + revalidation belong to a
    // single action.
    const planUpdate: LessonPlan | null = cleaned.length === 0
      ? null
      : {
          checkpoints: cleaned.map((label) => ({ id: genId(), label, completed_at: null })),
          last_updated_at: new Date().toISOString(),
        };

    const { error } = await supabase
      .from("sessions")
      .update({ lesson_plan: planUpdate as unknown } as TableUpdate<"sessions">)
      .eq("id", sessionId);
    if (error) throw new UserError("فشل حفظ خطة الدرس", { cause: error });

    revalidatePath(`/teacher/sessions/${sessionId}`);
    revalidatePath(`/student/sessions/${sessionId}`);
    return { message: cleaned.length === 0 ? "cleared" : "saved" };
  },
});

export async function setLessonPlan(sessionId: string, labels: string[]): Promise<ActionResult> {
  const result = await setLessonPlanBase({ sessionId, labels });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

// ─── toggleCheckpoint ───────────────────────────────────────────────────────

type ToggleCheckpointInput = {
  sessionId: string;
  checkpointId: string;
  completed: boolean;
};

const toggleCheckpointBase = loudAction<ToggleCheckpointInput, { message: string }>({
  name: "session.lesson-plan.toggle-checkpoint",
  severity: "info",
  audit: {
    table: "sessions",
    recordId: (i) => i.sessionId,
    action: "UPDATE",
    reasonPrefix: "teacher toggle lesson-plan checkpoint",
  },
  preflight: loggedInPreflight,
  handler: async ({ sessionId, checkpointId, completed }, { actorId }) => {
    const supabase = await createClient();
    await ensureCallerOwnsSession(supabase, sessionId, actorId!);

    const { data: row, error: rowErr } = await supabase
      .from("sessions")
      .select("lesson_plan")
      .eq("id", sessionId)
      .single<{ lesson_plan: LessonPlan | null }>();
    if (rowErr || !row) throw notFoundOrInfra(rowErr, "الجلسة غير موجودة");

    const plan = row.lesson_plan;
    if (!plan?.checkpoints) throw new UserError("لا توجد خطة درس");
    const idx = plan.checkpoints.findIndex((c) => c.id === checkpointId);
    if (idx === -1) throw new UserError("نقطة التحقق غير موجودة");

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
    if (error) throw new UserError("فشل تحديث نقطة التحقق", { cause: error });

    revalidatePath(`/teacher/sessions/${sessionId}`);
    revalidatePath(`/student/sessions/${sessionId}`);
    return { message: completed ? "checked" : "unchecked" };
  },
});

export async function toggleCheckpoint(
  sessionId: string,
  checkpointId: string,
  completed: boolean,
): Promise<ActionResult> {
  const result = await toggleCheckpointBase({ sessionId, checkpointId, completed });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

// ─── clearLessonPlan ────────────────────────────────────────────────────────

const clearLessonPlanBase = loudAction<{ sessionId: string }, { message: string }>({
  name: "session.lesson-plan.clear",
  severity: "info",
  audit: {
    table: "sessions",
    recordId: (i) => i.sessionId,
    action: "UPDATE",
    reasonPrefix: "teacher clear lesson plan",
  },
  preflight: loggedInPreflight,
  handler: async ({ sessionId }, { actorId }) => {
    const supabase = await createClient();
    await ensureCallerOwnsSession(supabase, sessionId, actorId!);

    const { error } = await supabase
      .from("sessions")
      .update({ lesson_plan: null } satisfies TableUpdate<"sessions">)
      .eq("id", sessionId);
    if (error) throw new UserError("فشل مسح خطة الدرس", { cause: error });

    revalidatePath(`/teacher/sessions/${sessionId}`);
    revalidatePath(`/student/sessions/${sessionId}`);
    return { message: "cleared" };
  },
});

export async function clearLessonPlan(sessionId: string): Promise<ActionResult> {
  const result = await clearLessonPlanBase({ sessionId });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
