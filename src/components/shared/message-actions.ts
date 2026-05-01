"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";

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

  const { data: inserted, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content,
    } as never)
    .select("id")
    .single<{ id: string }>();

  if (error || !inserted) return { error: "حدث خطأ أثناء إرسال الرسالة" };

  // Resolve the recipient once — used by both notify() and emitEvent() below.
  const { data: conv } = await supabase
    .from("conversations")
    .select("student_id, teacher_id")
    .eq("id", conversationId)
    .single<{ student_id: string; teacher_id: string }>();
  const recipientId = conv
    ? (conv.student_id === user.id ? conv.teacher_id : conv.student_id)
    : null;

  // Send notification to the other party (non-blocking)
  try {
    if (conv && recipientId) {
      const { data: sender } = await supabase
        .from("profiles").select("full_name").eq("id", user.id)
        .single<{ full_name: string | null }>();
      const senderName = sender?.full_name ?? "مستخدم";
      const preview = content.length > 50 ? content.slice(0, 50) + "…" : content;

      await notify(recipientId, "message", `رسالة جديدة من ${senderName}`, preview, "conversation", conversationId);
    }
  } catch { /* non-blocking */ }

  // Fire the message-moderation pipeline on n8n. Non-blocking; failures
  // are recorded in automation_logs by emit() itself.
  emitEvent("message.created", "message", inserted.id, {
    conversation_id: conversationId,
    sender_id: user.id,
    recipient_id: recipientId,
    content_length: content.length,
  }).catch((err) => logError("emit message.created failed", err, {
    tag: "messaging",
    component: "message-actions",
    conversationId,
  }));

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
    .update({ is_read: true } as never)
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
      .update({ is_read: true } as never)
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
