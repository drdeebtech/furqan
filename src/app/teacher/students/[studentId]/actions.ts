"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";

export async function resolveRecitationError(errorId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase
    .from("recitation_errors")
    .update({ resolved: true, resolved_at: new Date().toISOString() } as never)
    .eq("id", errorId);

  if (error) {
    logError("teacher resolveRecitationError failed", error, {
      tag: "teacher-students",
      severity: "warning",
      metadata: { errorId },
    });
    return { error: "فشل تحديث الخطأ — يرجى المحاولة مرة أخرى" };
  }
  revalidatePath("/teacher/students");
  return { success: true };
}

export async function updateSessionNotes(sessionId: string, notes: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح — يرجى تسجيل الدخول مرة أخرى" };

  const { error } = await supabase
    .from("sessions")
    .update({ post_session_notes: notes || null })
    .eq("id", sessionId);

  if (error) {
    logError("teacher updateSessionNotes failed", error, {
      tag: "teacher-students",
      severity: "warning",
      metadata: { sessionId },
    });
    return { error: "فشل تحديث الملاحظات — يرجى المحاولة مرة أخرى" };
  }
  revalidatePath("/teacher/students");
  return { success: true };
}
