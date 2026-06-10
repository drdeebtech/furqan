"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

export async function markAsRead(submissionId: string) {
  let actorId: string;
  try {
    ({ id: actorId } = await requireAdmin());
  } catch (err) {
    if (err instanceof ForbiddenError) return { success: false, error: "غير مصرح" };
    throw err;
  }

  const supabase = await createClient();

  const { data: current } = await supabase
    .from("contact_submissions")
    .select("is_read")
    .eq("id", submissionId)
    .single<{ is_read: boolean }>();

  const { error } = await supabase
    .from("contact_submissions")
    .update({ is_read: true } satisfies TableUpdate<"contact_submissions">)
    .eq("id", submissionId);
  if (error) {
    logError("admin.markAsRead failed", error, { tag: "admin-contacts" });
    return { success: false, error: error.message };
  }

  // Only write an audit row when the state actually changed.
  if (current?.is_read !== true) {
    await supabase.from("audit_log").insert({
      changed_by: actorId,
      table_name: "contact_submissions",
      record_id: submissionId,
      action: "UPDATE",
      old_data: { is_read: current?.is_read ?? false },
      new_data: { is_read: true },
      reason: "admin marked contact submission as read",
    } satisfies TableInsert<"audit_log">).then(({ error: auditErr }) => {
      if (auditErr) logError("markAsRead: audit row failed", auditErr, { tag: "admin-contacts" });
    });
  }

  revalidatePath("/admin/contacts");
  return { success: true };
}
