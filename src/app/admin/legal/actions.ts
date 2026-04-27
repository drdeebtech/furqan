"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction, type LoudResult } from "@/lib/actions/loud";
import { requireAdmin } from "@/lib/auth/require-admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const updateLegalBase = loudAction<{
  kind: "terms" | "privacy";
  body_ar: string | null;
  body_en: string | null;
}, { message?: string }>({
  name: "admin.legal.update",
  severity: "warning",
  audit: {
    table: "legal_documents",
    recordId: (i) => i.kind,
    action: "UPDATE",
    reasonPrefix: "admin updated legal document",
  },
  handler: async (input) => {
    const supabase = (await createClient()) as AnyClient;
    // Read current version, bump on save.
    const { data: existing } = await supabase
      .from("legal_documents")
      .select("version")
      .eq("kind", input.kind)
      .maybeSingle();
    const newVersion = (existing?.version ?? 0) + 1;
    const { error } = await supabase
      .from("legal_documents")
      .update({
        body_ar: input.body_ar,
        body_en: input.body_en,
        version: newVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("kind", input.kind);
    if (error) throw error;

    // Public consumers + admin self.
    revalidatePath(input.kind === "terms" ? "/terms" : "/privacy");
    revalidatePath("/admin/legal");
    return { message: `تم الحفظ — الإصدار ${newVersion}` };
  },
});

export async function updateLegal(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  try { await requireAdmin(); } catch { return { ok: false, error: "غير مصرح" }; }
  const kind = formData.get("kind");
  if (kind !== "terms" && kind !== "privacy") return { ok: false, error: "نوع غير صحيح" };
  const bodyAr = formData.get("body_ar");
  const bodyEn = formData.get("body_en");
  return updateLegalBase({
    kind,
    body_ar: typeof bodyAr === "string" && bodyAr.trim() ? bodyAr : null,
    body_en: typeof bodyEn === "string" && bodyEn.trim() ? bodyEn : null,
  });
}
