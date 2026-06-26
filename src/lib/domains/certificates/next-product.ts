import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

export interface NextProductSuggestion {
  id: string;
  title_ar: string;
  title_en: string | null;
  price_cents: number;
  currency: string;
}

/**
 * Suggest the next purchasable course after a student completes one.
 *
 * Returns null (neutral state) when:
 *   - No published courses exist beyond what the student has enrolled in.
 *   - Any DB error occurs (degrade-to-neutral — never fabricate).
 *
 * Never returns a broken link or invented product (SC-009 / T020).
 */
export async function suggestNextProduct(
  studentId: string,
  completedCourseId: string,
): Promise<NextProductSuggestion | null> {
  // admin: invoked from n8n webhook — no session; cross-reads enrollments (issue #523)
  const admin = createAdminClient();

  const { data: enrolledRaw, error: enrollErr } = await admin
    .from("course_enrollments")
    .select("course_id")
    .eq("student_id", studentId);
  const enrolled = enrolledRaw as { course_id: string }[] | null;

  if (enrollErr) {
    logError("suggestNextProduct: enrollment query failed", enrollErr, {
      tag: "certificates",
      student_id: studentId,
    });
    return null;
  }

  const enrolled_ids = new Set((enrolled ?? []).map((e) => e.course_id));
  enrolled_ids.add(completedCourseId);

  const { data: candidatesRaw, error: coursesErr } = await admin
    .from("courses")
    .select("id, title_ar, title_en, price_cents, currency")
    .eq("status", "published")
    .is("deleted_at", null)
    .order("price_cents", { ascending: true })
    .limit(50);
  const candidates = candidatesRaw as NextProductSuggestion[] | null;

  if (coursesErr) {
    logError("suggestNextProduct: courses query failed", coursesErr, {
      tag: "certificates",
      student_id: studentId,
    });
    return null;
  }

  const next = (candidates ?? []).find((c) => !enrolled_ids.has(c.id));
  return next ?? null;
}
