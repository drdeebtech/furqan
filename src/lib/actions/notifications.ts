"use server";

import { createClient } from "@/lib/supabase/server";
import type { Notification } from "@/types/database";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";
import { loudAction } from "@/lib/actions/loud";
import { UserError } from "@/lib/actions/user-error";

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

const markAsReadBase = loudAction<{ notificationId: string }, void>({
  name: "notifications.markAsRead",
  handler: async ({ notificationId }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مصرح");

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true } satisfies TableUpdate<"notifications">)
      .eq("id", notificationId)
      .eq("user_id", user.id);

    if (error) throw new UserError("فشل تحديث الإشعار — يرجى المحاولة مرة أخرى", { cause: error });
  },
});

export async function markAsRead(notificationId: string) {
  return markAsReadBase({ notificationId });
}

const markAllAsReadBase = loudAction<void, void>({
  name: "notifications.markAllAsRead",
  handler: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مصرح");

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true } satisfies TableUpdate<"notifications">)
      .eq("user_id", user.id)
      .eq("is_read", false);

    if (error) throw new UserError("فشل تحديث الإشعارات — يرجى المحاولة مرة أخرى", { cause: error });
  },
});

export async function markAllAsRead() {
  return markAllAsReadBase();
}

const deleteNotificationBase = loudAction<{ notificationId: string }, void>({
  name: "notifications.deleteNotification",
  handler: async ({ notificationId }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مصرح");

    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", notificationId)
      .eq("user_id", user.id);

    if (error) throw new UserError("فشل حذف الإشعار — يرجى المحاولة مرة أخرى", { cause: error });
  },
});

export async function deleteNotification(notificationId: string) {
  return deleteNotificationBase({ notificationId });
}
