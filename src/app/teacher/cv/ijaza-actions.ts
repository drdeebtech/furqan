"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction, type LoudResult } from "@/lib/actions/loud";
import { logError } from "@/lib/logger";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Teacher self-submit ijaza. Always inserts with verified_by=null so the
// admin moderation queue treats it as "pending review". Teachers cannot
// self-verify (RLS + audit_log + this action all reinforce that).
const upsertMyIjazaBase = loudAction<{
  teacherId: string;
  id: string | null;
  riwaya: string;
  chain_text: string;
  granted_by: string | null;
  granted_at: string | null;
  document_url: string | null;
}, { message?: string }>({
  name: "teacher.cv.upsert-my-ijaza",
  severity: "info",
  audit: {
    table: "teacher_ijaza",
    recordId: (i) => i.id ?? "(new)",
    action: "UPDATE",
    reasonPrefix: "teacher self-submit ijaza",
  },
  handler: async (input) => {
    const supabase = await createClient();
    const row = {
      teacher_id: input.teacherId,
      riwaya: input.riwaya,
      chain_text: input.chain_text,
      granted_by: input.granted_by,
      granted_at: input.granted_at,
      document_url: input.document_url,
    };

    if (input.id) {
      // Edit existing — only allowed when this row belongs to the teacher
      // AND is not yet verified. The .eq() chain enforces both.
      const { data, error } = await supabase
        .from("teacher_ijaza")
        .update(row as never)
        .eq("id", input.id)
        .eq("teacher_id", input.teacherId)
        .is("verified_by", null)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("لا يمكن تعديل الإجازة الموثقة. تواصل مع الإدارة.");
      }
    } else {
      const { error } = await supabase.from("teacher_ijaza").insert(row as never);
      if (error) throw error;
    }

    revalidatePath("/teacher/cv");
    revalidatePath(`/admin/teachers/${input.teacherId}`);
    revalidatePath(`/admin/teachers/cv/${input.teacherId}`);
    return { message: input.id ? "تم تحديث الإجازة" : "تم إرسال الإجازة للمراجعة" };
  },
});

export async function upsertMyIjaza(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مصرح" };

  const riwaya = str(formData, "riwaya");
  const chain_text = str(formData, "chain_text");
  if (!riwaya) return { ok: false, error: "الرواية مطلوبة" };
  if (!chain_text) return { ok: false, error: "سند الإجازة مطلوب" };

  return upsertMyIjazaBase({
    teacherId: user.id,
    id: str(formData, "id"),
    riwaya,
    chain_text,
    granted_by: str(formData, "granted_by"),
    granted_at: str(formData, "granted_at"),
    document_url: str(formData, "document_url"),
  });
}

export async function deleteMyIjaza(ijazaId: string): Promise<LoudResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مصرح" };

  // Only delete if owned + unverified. .eq() + .is("verified_by", null) gates it.
  const { data, error } = await supabase
    .from("teacher_ijaza")
    .delete()
    .eq("id", ijazaId)
    .eq("teacher_id", user.id)
    .is("verified_by", null)
    .select("id");
  if (error) {
    logError("teacher deleteMyIjaza failed", error, {
      tag: "teacher-cv",
      severity: "warning",
      metadata: { ijazaId, teacherId: user.id },
    });
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "لا يمكن حذف الإجازة الموثقة. تواصل مع الإدارة." };
  }

  revalidatePath("/teacher/cv");
  revalidatePath(`/admin/teachers/${user.id}`);
  return { ok: true, message: "تم حذف الإجازة" };
}
