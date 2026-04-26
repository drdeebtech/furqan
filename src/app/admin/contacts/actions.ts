"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";

export async function markAsRead(submissionId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("contact_submissions")
    .update({ is_read: true } as never)
    .eq("id", submissionId);
  if (error) {
    logError("admin.markAsRead failed", error, { tag: "admin-contacts" });
    return { success: false, error: error.message };
  }
  revalidatePath("/admin/contacts");
  return { success: true };
}
