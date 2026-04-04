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

  revalidatePath("/student/messages");
  revalidatePath("/teacher/messages");
  return { success: true };
}

export async function getMessages(conversationId: string) {
  const supabase = await createClient();

  const { data } = await supabase
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

  return data ?? [];
}
