import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MessagesView } from "@/components/shared/messages-view";

export const metadata: Metadata = { title: "الرسائل" };

export default async function TeacherMessagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, student_id, teacher_id, last_message_at")
    .eq("teacher_id", user.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .returns<{ id: string; student_id: string; teacher_id: string; last_message_at: string | null }[]>();

  const convos = conversations ?? [];

  let nameMap: Record<string, string> = {};
  if (convos.length > 0) {
    const ids = convos.map((c) => c.student_id);
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? "طالب"]));
  }

  const convList = convos.map((c) => ({
    id: c.id,
    otherUserId: c.student_id,
    otherUserName: nameMap[c.student_id] ?? "طالب",
    lastMessageAt: c.last_message_at,
  }));

  return <MessagesView conversations={convList} currentUserId={user.id} role="teacher" />;
}
