"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction } from "@/lib/actions/loud";

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
    const { error } = await supabase
      .from("recitation_errors")
      .update({ resolved: true, resolved_at: new Date().toISOString() } as never)
      .eq("id", errorId);
    if (error) throw new UserError("فشل تحديث الخطأ — يرجى المحاولة مرة أخرى", { cause: error });
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
    const { error } = await supabase
      .from("sessions")
      .update({ post_session_notes: notes || null } as never)
      .eq("id", sessionId);
    if (error) throw new UserError("فشل تحديث الملاحظات — يرجى المحاولة مرة أخرى", { cause: error });
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
