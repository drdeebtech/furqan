"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loudAction, type LoudResult } from "@/lib/actions/loud";
import { requireAdmin } from "@/lib/auth/require-admin";
import { emitEvent } from "@/lib/automation/emit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const updateLegalSchema = z.object({
  kind: z.enum(["terms", "privacy"]),
  // Bound the bodies — legal docs are long but not unbounded; 50k chars is
  // ~10x the longest current document and prevents accidental DoS via giant
  // paste from the admin form.
  body_ar: z.string().max(50_000).nullable(),
  body_en: z.string().max(50_000).nullable(),
});

const updateLegalBase = loudAction<z.infer<typeof updateLegalSchema>, { message?: string }>({
  name: "admin.legal.update",
  severity: "warning",
  schema: updateLegalSchema,
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

    void emitEvent("legal_document.updated", "legal_document", input.kind, { document_type: input.kind }, ctx.actorId);

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
  // Hand the raw FormData values to the schema; loudAction surfaces a
  // friendly Arabic field error for any shape violation (e.g. invalid kind).
  const bodyAr = formData.get("body_ar");
  const bodyEn = formData.get("body_en");
  return updateLegalBase({
    kind: formData.get("kind") as "terms" | "privacy",
    body_ar: typeof bodyAr === "string" && bodyAr.trim() ? bodyAr : null,
    body_en: typeof bodyEn === "string" && bodyEn.trim() ? bodyEn : null,
  });
}
