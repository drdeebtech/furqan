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
  const supabase = await createClient();
  const { data } = await supabase
    .from("legal_documents")
    .select("kind, body_ar, body_en, version, updated_at")
    .eq("kind", kind)
    .maybeSingle();
  return (data as LegalDocument | null) ?? null;
}
