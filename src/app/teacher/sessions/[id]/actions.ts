"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
