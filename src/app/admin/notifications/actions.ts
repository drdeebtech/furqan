"use server";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

export async function sendNotification(formData: FormData) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "ليس لديك صلاحية" };
    throw e;
  }

  const supabase = await createClient();
  const title = formData.get("title") as string;
  const body = formData.get("body") as string;
  const target = formData.get("target") as string; // all, student, teacher

  let query = supabase.from("profiles").select("id").eq("is_active", true);
  if (target === "student") query = query.eq("role", "student");
  else if (target === "teacher") query = query.eq("role", "teacher");

  const { data: users } = await query.returns<{ id: string }[]>();
  if (!users || users.length === 0) return { error: "لا يوجد مستخدمون مستهدفون" };

  // Route through dispatcher so prefs, quiet hours, and delivery logging apply.
  await Promise.all(
    users.map((u) =>
      notify({
        userId: u.id,
        type: "system",
        title,
        body,
      }).catch((err) => {
        logError("notify failed during admin broadcast", err, {
          component: "admin.notifications.sendNotification",
          metadata: { userId: u.id, title },
        });
      }),
    ),
  );

  // Tag-based: invalidate the cached broadcasts list so the next /admin/notifications
  // render rebuilds it. Only the broadcast list is cached; the auth check + form
  // shell still render dynamically.
  // Next 16 two-arg form: "max" expires every cacheLife profile that uses
  // this tag, regardless of stale window — correct for an admin write that
  // should reflect immediately in the recent-broadcasts list.
  revalidateTag("notifications:admin:broadcasts", "max");
  return { success: true, count: users.length };
}
