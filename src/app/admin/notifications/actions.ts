"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";

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
      dispatchNotification({
        userId: u.id,
        type: "system",
        title,
        body,
      }).catch(() => undefined),
    ),
  );

  revalidatePath("/admin/notifications");
  return { success: true, count: users.length };
}
