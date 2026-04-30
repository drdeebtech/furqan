import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { getRecentBroadcasts } from "@/lib/notifications/queries";
import { NotificationForm } from "./notification-form";

export const metadata: Metadata = { title: "الإشعارات" };

export default async function AdminNotificationsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Tag-cached read; invalidated by sendNotification via revalidateTag.
  const recent = await getRecentBroadcasts(20);

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Bell size={24} className="text-gold" /> {t("الإشعارات", "Notifications")}</h1>

      <NotificationForm />

      {recent.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-4 text-lg font-bold">{t("آخر الإشعارات المرسلة", "Recent Sent Notifications")}</h2>
          <div className="space-y-2">
            {recent.map(n => (
              <div key={n.id} className="glass-card rounded-lg px-4 py-3">
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="mt-1 text-xs text-muted">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{new Date(n.created_at).toLocaleString(lang === "ar" ? "ar" : "en-US")}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
