"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { loudAction, notFoundOrInfra } from "@/lib/actions/loud";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

const markAsReadBase = loudAction<{ submissionId: string }, void>({
  name: "admin.contacts.markAsRead",
  handler: async ({ submissionId }) => {
    const { id: actorId } = await requireAdmin();
    const supabase = await createClient();

    // Single conditional UPDATE: only transitions unread→read and returns the
    // row if this request performed the transition — atomic, no separate select.
    const { data: updated, error } = await supabase
      .from("contact_submissions")
      .update({ is_read: true } satisfies TableUpdate<"contact_submissions">)
      .eq("id", submissionId)
      .eq("is_read", false)
      .select("id")
      .maybeSingle();

    if (error) {
      logError("admin.markAsRead failed", error, { tag: "admin-contacts" });
      throw notFoundOrInfra(error, "تعذر تحديث حالة الرسالة");
    }

    // Side effects only when this request performed the unread→read transition.
    if (updated) {
      await supabase.from("audit_log").insert({
        changed_by: actorId,
        table_name: "contact_submissions",
        record_id: submissionId,
        action: "UPDATE",
        old_data: { is_read: false },
        new_data: { is_read: true },
        reason: "admin marked contact submission as read",
      } satisfies TableInsert<"audit_log">).then(({ error: auditErr }) => {
        if (auditErr) logError("markAsRead: audit row failed", auditErr, { tag: "admin-contacts" });
      });

      void emitEvent("contact_submission.read", "contact_submission", submissionId, {}, actorId);
    }

    revalidatePath("/admin/contacts");
  },
});

export async function markAsRead(submissionId: string) {
  const parsed = z.uuid().safeParse(submissionId);
  if (!parsed.success) return { ok: false as const, error: "معرف غير صالح" };
  return markAsReadBase({ submissionId: parsed.data });
}
