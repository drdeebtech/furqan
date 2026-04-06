"use server";

import { createClient } from "@/lib/supabase/server";

export async function createConversation(otherUserId: string, role: "student" | "teacher") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const studentId = role === "student" ? user.id : otherUserId;
  const teacherId = role === "teacher" ? user.id : otherUserId;

  // Check if conversation already exists
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("student_id", studentId)
    .eq("teacher_id", teacherId)
    .single<{ id: string }>();

  if (existing) return { conversationId: existing.id };

  // Create new conversation
  const { data: conv, error } = await supabase
    .from("conversations")
    .insert({ student_id: studentId, teacher_id: teacherId } as never)
    .select("id")
    .single<{ id: string }>();

  if (error || !conv) return { error: "فشل إنشاء المحادثة" };
  return { conversationId: conv.id };
}

export async function getContactsForRole(role: "student" | "teacher") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Fetch bookings to find the other party
  const { data: bookings } = await supabase
    .from("bookings")
    .select("student_id, teacher_id")
    .eq(role === "student" ? "student_id" : "teacher_id", user.id)
    .in("status", ["confirmed", "completed"])
    .returns<{ student_id: string; teacher_id: string }[]>();

  if (!bookings || bookings.length === 0) return [];

  const otherIds = [...new Set(bookings.map(b => role === "student" ? b.teacher_id : b.student_id))];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", otherIds)
    .returns<{ id: string; full_name: string | null }[]>();

  return (profiles ?? []).map(p => ({ id: p.id, name: p.full_name ?? "—" }));
}
