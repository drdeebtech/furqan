"use server";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import { processBroadcast } from "@/lib/notifications/broadcast";
import type { TableInsert } from "@/lib/supabase/typed-helpers";

export async function sendNotification(formData: FormData) {
  let actorId: string;
  try {
    ({ id: actorId } = await requireAdmin());
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "ليس لديك صلاحية" };
    throw e;
  }

  const title = (formData.get("title") as string | null)?.trim() ?? "";
  const body = (formData.get("body") as string | null)?.trim() || null;
  const targetRaw = (formData.get("target") as string | null) ?? "all";
  const target = (["all", "student", "teacher"] as const).includes(targetRaw as never)
    ? (targetRaw as "all" | "student" | "teacher")
    : "all";
  if (!title) return { error: "العنوان مطلوب" };

  // Audit H7: enqueue ONE row and return immediately — do NOT fan out to every
  // active user on the request path. Delivery runs off-path: started now via
  // after(), and a dual-auth /api/cron/process-broadcasts drainer finishes any
  // remainder a large audience couldn't complete within this function budget.
  const admin = createAdminClient();
  const { data: broadcast, error } = await admin
    .from("notification_broadcasts")
    .insert({ target, title, body, initiated_by: actorId } satisfies TableInsert<"notification_broadcasts">)
    .select("id")
    .single<{ id: string }>();
  if (error || !broadcast) {
    logError("sendNotification: enqueue failed", error, {
      component: "admin.notifications.sendNotification", metadata: { target, title },
    });
    return { error: "فشل إرسال الإشعار" };
  }

  after(() =>
    processBroadcast(broadcast.id).catch(err =>
      logError("sendNotification: after() delivery failed", err, {
        component: "admin.notifications.sendNotification", metadata: { broadcastId: broadcast.id },
      }),
    ),
  );

  revalidateTag("notifications:admin:broadcasts", "max");
  return { success: true, broadcastId: broadcast.id };
}
