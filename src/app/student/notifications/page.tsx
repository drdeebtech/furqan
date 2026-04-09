import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bell, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { Notification } from "@/types/database";
import { NotificationsList } from "./notifications-list";

export const metadata: Metadata = { title: "الإشعارات" };

export default async function StudentNotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<Notification[]>();

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Bell size={24} className="text-gold" />
        <h1 className="text-xl font-bold">الإشعارات</h1>
        <span className="text-sm text-muted">Notifications</span>
      </div>

      {!notifications || notifications.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">لا توجد إشعارات</p>
        </div>
      ) : (
        <NotificationsList notifications={notifications} />
      )}
    </div>
  );
}
