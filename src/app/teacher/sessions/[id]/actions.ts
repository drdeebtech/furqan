"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { emitEvent } from "@/lib/automation/emit";

export async function savePostSessionNotes(
  sessionId: string,
  notes: string,
  homework: string,
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase
    .from("sessions")
    .update({
      post_session_notes: notes || null,
      homework: homework || null,
    } as never)
    .eq("id", sessionId);

  if (error) {
    return { error: "حدث خطأ أثناء حفظ الملاحظات — يرجى المحاولة مرة أخرى" };
  }

  revalidatePath(`/teacher/sessions/${sessionId}`);
  try { await emitEvent("session.notes_saved", "session", sessionId, { has_notes: !!notes, has_homework: !!homework }); } catch {}
  return { success: true };
}
