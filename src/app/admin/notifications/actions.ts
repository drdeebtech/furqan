"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function sendNotification(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const title = formData.get("title") as string;
  const body = formData.get("body") as string;
  const target = formData.get("target") as string; // all, student, teacher

  // Get target user IDs
  let query = supabase.from("profiles").select("id").eq("is_active", true);
  if (target === "student") query = query.eq("role", "student");
  else if (target === "teacher") query = query.eq("role", "teacher");

  const { data: users } = await query.returns<{ id: string }[]>();
  if (!users || users.length === 0) return { error: "لا يوجد مستخدمون مستهدفون" };

  const notifications = users.map(u => ({
    user_id: u.id,
    type: "system",
    title,
    body,
    channel: ["in_app"],
  }));

  await supabase.from("notifications").insert(notifications as never);
  revalidatePath("/admin/notifications");
  return { success: true, count: users.length };
}
