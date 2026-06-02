"use server";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import type { Notification } from "@/types/database";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

export async function fetchNotifications(limit = 20) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح", notifications: [] };

  const { data } = await supabase
    .from("notifications")
    .select("id, user_id, type, channel, title, body, data, is_read, expires_at, created_at")
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

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true } satisfies TableUpdate<"notifications">)
    .eq("id", notificationId)
    .eq("user_id", user.id);

  if (error) {
    logError("notifications markAsRead failed", error, {
      tag: "notifications",
      severity: "warning",
      metadata: { notificationId, userId: user.id },
    });
    return { error: "فشل تحديث الإشعار — يرجى المحاولة مرة أخرى" };
  }
  return { success: true };
}

export async function markAllAsRead() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true } satisfies TableUpdate<"notifications">)
    .eq("user_id", user.id)
    .eq("is_read", false);

  if (error) {
    logError("notifications markAllAsRead failed", error, {
      tag: "notifications",
      severity: "warning",
      metadata: { userId: user.id },
    });
    return { error: "فشل تحديث الإشعارات — يرجى المحاولة مرة أخرى" };
  }
  return { success: true };
}

export async function deleteNotification(notificationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId)
    .eq("user_id", user.id);

  if (error) {
    logError("notifications deleteNotification failed", error, {
      tag: "notifications",
      severity: "warning",
      metadata: { notificationId, userId: user.id },
    });
    return { error: "فشل حذف الإشعار — يرجى المحاولة مرة أخرى" };
  }
  return { success: true };
}
