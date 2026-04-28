import { createClient } from "@/lib/supabase/server";

export type LegalKind = "terms" | "privacy";

export interface LegalDocument {
  kind: LegalKind;
  body_ar: string | null;
  body_en: string | null;
  version: number;
  updated_at: string;
}

export interface LegalDocumentVersion {
  id: string;
  kind: LegalKind;
  version: number;
  body_ar: string | null;
  body_en: string | null;
  effective_at: string;
  superseded_at: string | null;
  saved_by: string | null;
  created_at: string;
}

export async function getLegalDocument(kind: LegalKind): Promise<LegalDocument | null> {
  // legal_documents was added in v16_002; supabase.generated.ts not regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("legal_documents")
    .select("kind, body_ar, body_en, version, updated_at")
    .eq("kind", kind)
    .maybeSingle();
  return (data as LegalDocument | null) ?? null;
}
