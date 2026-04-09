"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function sendMessage(conversationId: string, content: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: user.id,
    content,
  } as never);

  if (error) return { error: "حدث خطأ أثناء إرسال الرسالة" };

  // Send notification to the other party (non-blocking)
  try {
    const { data: conv } = await supabase
      .from("conversations")
      .select("student_id, teacher_id")
      .eq("id", conversationId)
      .single<{ student_id: string; teacher_id: string }>();
    if (conv) {
      const recipientId = conv.student_id === user.id ? conv.teacher_id : conv.student_id;
      const { data: sender } = await supabase
        .from("profiles").select("full_name").eq("id", user.id)
        .single<{ full_name: string | null }>();
      const senderName = sender?.full_name ?? "مستخدم";
      const preview = content.length > 50 ? content.slice(0, 50) + "…" : content;

      await supabase.from("notifications").insert({
        user_id: recipientId,
        type: "message",
        title: `رسالة جديدة من ${senderName}`,
        body: preview,
        channel: ["in_app"],
      } as never);
    }
  } catch { /* non-blocking */ }

  revalidatePath("/student/messages");
  revalidatePath("/teacher/messages");
  return { success: true };
}

export async function markConversationAsRead(conversationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  // Mark all messages NOT sent by current user as read
  await supabase
    .from("messages")
    .update({ is_read: true } as never)
    .eq("conversation_id", conversationId)
    .neq("sender_id", user.id)
    .eq("is_read", false);

  return { success: true };
}

export async function getUnreadMessageCount() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  // Get all conversations for this user
  const { data: convos } = await supabase
    .from("conversations")
    .select("id")
    .or(`student_id.eq.${user.id},teacher_id.eq.${user.id}`)
    .returns<{ id: string }[]>();

  if (!convos || convos.length === 0) return 0;

  const convIds = convos.map(c => c.id);
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", convIds)
    .neq("sender_id", user.id)
    .eq("is_read", false)
    .is("deleted_at", null);

  return count ?? 0;
}

export async function getMessages(conversationId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, content, msg_type, created_at, is_read")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .returns<{
      id: string;
      sender_id: string;
      content: string;
      msg_type: string;
      created_at: string;
      is_read: boolean;
    }[]>();

  if (error) {
    console.error("Failed to fetch messages:", error.message);
  }

  return data ?? [];
}
