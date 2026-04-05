"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function resolveRecitationError(errorId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase
    .from("recitation_errors")
    .update({ resolved: true, resolved_at: new Date().toISOString() } as never)
    .eq("id", errorId);

  if (error) return { error: "فشل تحديث الخطأ" };
  revalidatePath("/teacher/students");
  return { success: true };
}

export async function updateSessionNotes(sessionId: string, notes: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase
    .from("sessions")
    .update({ post_session_notes: notes || null } as never)
    .eq("id", sessionId);

  if (error) return { error: "فشل تحديث الملاحظات" };
  revalidatePath("/teacher/students");
  return { success: true };
}
