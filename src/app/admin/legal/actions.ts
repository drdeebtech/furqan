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
  handler: async (input, ctx) => {
    const supabase = (await createClient()) as AnyClient;
    const now = new Date().toISOString();

    // Snapshot the current row into legal_document_versions BEFORE we
    // overwrite. Skip when there's nothing to snapshot (first save) or
    // when the body would be identical to the snapshot (no-op edit).
    const { data: existing } = await supabase
      .from("legal_documents")
      .select("version, body_ar, body_en, updated_at")
      .eq("kind", input.kind)
      .maybeSingle();

    const newVersion = (existing?.version ?? 0) + 1;
    const isContentChange =
      !existing ||
      existing.body_ar !== input.body_ar ||
      existing.body_en !== input.body_en;

    if (existing && (existing.body_ar || existing.body_en) && isContentChange) {
      // Mark the previous version row (if any) as superseded.
      await supabase
        .from("legal_document_versions")
        .update({ superseded_at: now })
        .eq("kind", input.kind)
        .is("superseded_at", null);
      // Append the snapshot of the version we're about to replace.
      const { error: snapErr } = await supabase
        .from("legal_document_versions")
        .insert({
          kind: input.kind,
          version: existing.version,
          body_ar: existing.body_ar,
          body_en: existing.body_en,
          effective_at: existing.updated_at ?? now,
          superseded_at: now,
          saved_by: ctx.actorId ?? null,
        });
      if (snapErr) throw snapErr;
    }

    const { error } = await supabase
      .from("legal_documents")
      .upsert(
        {
          kind: input.kind,
          body_ar: input.body_ar,
          body_en: input.body_en,
          version: newVersion,
          updated_at: now,
        },
        { onConflict: "kind" },
      );
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
