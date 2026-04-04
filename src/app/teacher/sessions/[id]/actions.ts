"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Save post-session notes and homework for a session and revalidate the session page.
 *
 * @param sessionId - The ID of the session row to update
 * @param notes - Post-session notes; pass an empty string to clear the field
 * @param homework - Homework text; pass an empty string to clear the field
 * @returns `{ success: true }` on successful save; `{ error: <message> }` if the user is not authenticated or if saving fails
 */
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
    return { error: "حدث خطأ أثناء حفظ الملاحظات" };
  }

  revalidatePath(`/teacher/sessions/${sessionId}`);
  return { success: true };
}
