"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import { unreadMessagesFilter } from "@/lib/views/_shared/unread-messages";

type MessageRow = {
  id: string;
  sender_id: string;
  content: string;
  msg_type: string;
  created_at: string;
  is_read: boolean;
};

export async function sendMessage(conversationId: string, content: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: user.id,
    content,
  });

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

      await notify({
        userId: recipientId,
        type: "message",
        title: `رسالة جديدة من ${senderName}`,
        body: preview,
        entityType: "conversation",
        entityId: conversationId,
      });
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

  const { error } = await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("conversation_id", conversationId)
    .neq("sender_id", user.id)
    .eq("is_read", false);

  if (error) {
    logError("markConversationAsRead failed", error, {
      tag: "messaging",
      component: "message-actions",
      conversationId,
    });
    return { error: "حدث خطأ أثناء تحديث حالة القراءة" };
  }

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
  const { count } = await unreadMessagesFilter(supabase, convIds, user.id);

  return count ?? 0;
}

export async function getMessages(conversationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, content, msg_type, created_at, is_read")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .returns<MessageRow[]>();

  if (error) {
    logError("Failed to fetch messages", error, { tag: "message-actions", conversationId });
    return [];
  }

  const unreadIncomingIds = (data ?? [])
    .filter((message) => message.sender_id !== user.id && !message.is_read)
    .map((message) => message.id);

  if (unreadIncomingIds.length > 0) {
    const { error: markError } = await supabase
      .from("messages")
      .update({ is_read: true })
      .in("id", unreadIncomingIds);

    if (markError) {
      logError("getMessages mark-as-read failed", markError, {
        tag: "messaging",
        component: "message-actions",
        conversationId,
      });
    } else {
      return data.map((message) => (
        unreadIncomingIds.includes(message.id)
          ? { ...message, is_read: true }
          : message
      ));
    }
  }

  return data ?? [];
}
