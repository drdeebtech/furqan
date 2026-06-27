import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { surahName } from "@/lib/quran/surahs";

// Display-safe certificate shape for the public /certificates/[slug] page.
// NEVER add email, phone, dob, address, or any auth-identifying field here.
export interface PublicCertificate {
  id: string;
  public_slug: string;
  certificate_type: "appreciation_juz" | "appreciation_level" | "course_completion";
  milestone_key: string;
  cited_range_start: string;
  cited_range_end: string;
  /** Arabic surah name for cited_range_start (null for course_completion which has no range) */
  cited_start_surah_ar: string | null;
  /** Arabic surah name for cited_range_end */
  cited_end_surah_ar: string | null;
  /** Arabic full name from profiles.full_name_ar; fallback to profiles.full_name */
  display_name: string | null;
  issued_at: string;
  pdf_url: string | null;
}

/**
 * Load a certificate by its public (capability) slug.
 *
 * Auth model (spec 031, Decision 6): the unguessable UUID slug IS the
 * authorization. Reads via createAdminClient to bypass RLS — no session
 * is available on the public page. Returns only display-safe columns.
 * Returns null (→ caller 404) if no row matches the slug.
 */
export async function getPublicCertificate(
  slug: string,
): Promise<PublicCertificate | null> {
  const admin = createAdminClient();

  // Step 1: cert row by exact slug (capability-URL auth)
  const { data: cert, error: certErr } = await admin
    .from("certificates")
    .select(
      "id, public_slug, certificate_type, milestone_key, cited_range_start, cited_range_end, issued_at, pdf_url, student_id",
    )
    .eq("public_slug", slug)
    .maybeSingle();

  if (certErr || !cert) return null;

  // Step 2: display-safe name — best-effort, no throw if missing
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name_ar, full_name")
    .eq("id", cert.student_id)
    .maybeSingle();

  const startSurahNum = parseSurahNum(cert.cited_range_start);
  const endSurahNum = parseSurahNum(cert.cited_range_end);

  return {
    id: cert.id,
    public_slug: cert.public_slug,
    certificate_type: cert.certificate_type,
    milestone_key: cert.milestone_key,
    cited_range_start: cert.cited_range_start,
    cited_range_end: cert.cited_range_end,
    cited_start_surah_ar: surahName(startSurahNum, "ar"),
    cited_end_surah_ar: surahName(endSurahNum, "ar"),
    display_name: profile?.full_name_ar ?? profile?.full_name ?? null,
    issued_at: cert.issued_at,
    pdf_url: cert.pdf_url ?? null,
  };
}

function parseSurahNum(range: string | null | undefined): number | null {
  if (!range) return null;
  const [surahStr] = range.split(":");
  const n = parseInt(surahStr, 10);
  return Number.isFinite(n) && n >= 1 && n <= 114 ? n : null;
}
