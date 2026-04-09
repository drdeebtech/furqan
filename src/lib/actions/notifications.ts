"use server";

import { createClient } from "@/lib/supabase/server";
import type { Notification } from "@/types/database";

export async function fetchNotifications(limit = 20) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح", notifications: [] };

  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Notification[]>();

  return { notifications: data ?? [] };
}

export async function getUnreadCount() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_read", false);

  return count ?? 0;
}

export async function markAsRead(notificationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  await supabase
    .from("notifications")
    .update({ is_read: true } as never)
    .eq("id", notificationId)
    .eq("user_id", user.id);

  return { success: true };
}

export async function markAllAsRead() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  await supabase
    .from("notifications")
    .update({ is_read: true } as never)
    .eq("user_id", user.id)
    .eq("is_read", false);

  return { success: true };
}

export async function deleteNotification(notificationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId)
    .eq("user_id", user.id);

  return { success: true };
}
