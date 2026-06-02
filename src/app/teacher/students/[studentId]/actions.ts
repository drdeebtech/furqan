"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction } from "@/lib/actions/loud";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

async function loggedInPreflight(): Promise<{ actorId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مصرح");
  return { actorId: user.id };
}

// ─── resolveRecitationError ─────────────────────────────────────────────────

const resolveRecitationErrorBase = loudAction<{ errorId: string }, { message: string }>({
  name: "teacher.students.resolve-recitation-error",
  severity: "info",
  audit: {
    table: "recitation_errors",
    recordId: (i) => i.errorId,
    action: "UPDATE",
    reasonPrefix: "teacher resolve recitation error",
  },
  preflight: loggedInPreflight,
  handler: async ({ errorId }) => {
    const supabase = await createClient();
    // `.select()` makes the update return the rows it touched. RLS-denied
    // updates (or updates on a non-existent id) come back with `error: null`
    // and `data: []` — without this, the wrap would silently log "success"
    // for a write that affected zero rows. Defense-in-depth flagged by
    // CodeRabbit on PR #271.
    const { data, error } = await supabase
      .from("recitation_errors")
      .update({ resolved: true, resolved_at: new Date().toISOString() } satisfies TableUpdate<"recitation_errors">)
      .eq("id", errorId)
      .select("id");
    if (error) throw new UserError("فشل تحديث الخطأ — يرجى المحاولة مرة أخرى", { cause: error });
    if (!data || data.length === 0) {
      throw new UserError("الخطأ غير موجود أو ليس لديك صلاحية عليه");
    }
    revalidatePath("/teacher/students");
    return { message: "resolved" };
  },
});

export async function resolveRecitationError(
  errorId: string,
): Promise<{ success?: true; error?: string }> {
  const result = await resolveRecitationErrorBase({ errorId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── updateSessionNotes ─────────────────────────────────────────────────────

type UpdateSessionNotesInput = { sessionId: string; notes: string };

const updateSessionNotesBase = loudAction<UpdateSessionNotesInput, { message: string }>({
  name: "teacher.students.update-session-notes",
  severity: "info",
  audit: {
    table: "sessions",
    recordId: (i) => i.sessionId,
    action: "UPDATE",
    reasonPrefix: "teacher update session notes",
  },
  preflight: loggedInPreflight,
  handler: async ({ sessionId, notes }) => {
    const supabase = await createClient();
    // See note in resolveRecitationError above — `.select()` catches the
    // RLS-denial silent-no-op pattern. (CodeRabbit PR #271.)
    const { data, error } = await supabase
      .from("sessions")
      .update({ post_session_notes: notes || null } satisfies TableUpdate<"sessions">)
      .eq("id", sessionId)
      .select("id");
    if (error) throw new UserError("فشل تحديث الملاحظات — يرجى المحاولة مرة أخرى", { cause: error });
    if (!data || data.length === 0) {
      throw new UserError("الجلسة غير موجودة أو ليس لديك صلاحية عليها");
    }
    revalidatePath("/teacher/students");
    return { message: "saved" };
  },
});

export async function updateSessionNotes(
  sessionId: string,
  notes: string,
): Promise<{ success?: true; error?: string }> {
  const result = await updateSessionNotesBase({ sessionId, notes });
  if (!result.ok) return { error: result.error };
  return { success: true };
}
