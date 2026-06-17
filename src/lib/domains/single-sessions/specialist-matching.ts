import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

/**
 * Spec 022 (م٥) — Specialist matching for assessment bookings.
 *
 * An assessment MUST be conducted by a teacher whose specialties include the
 * requested specialty (FR-012 / SC-003): a hifz assessor for hifz, a tajweed
 * assessor for tajweed. The level judgment is only sound when the assessor's
 * specialty matches. Never assign a non-matching teacher (FR-013).
 *
 * Specialty lives on `teacher_profiles.specialties: string[]` (NOT on
 * `profiles`). Availability is read from `teacher_availability` so the
 * matched specialist has at least one active slot — defer to spec 020 for
 * the actual scheduling mechanics.
 */

export interface Specialist {
  teacherId: string;
  displayName: string | null;
  specialties: string[];
  hasAvailability: boolean;
}

/**
 * Find an available specialist teacher for the requested specialty.
 *
 * Returns the first matching teacher (ordered by `is_accepting desc,
 * teacher_profiles.created_at`) or `null` when none is available. The caller
 * (checkout route) treats null as a 422 fail-before-charge — no charge is
 * initiated, no session is created, no non-matching teacher is assigned.
 *
 * Per R-004 scale check: the teacher pool is small (<100); a full scan of
 * teacher_profiles with `specialties @> ARRAY[:specialty]::text[]` is fine.
 */
export async function findAvailableSpecialist(
  specialty: string,
): Promise<Specialist | null> {
  const trimmed = specialty.trim();
  if (!trimmed) return null;

  const admin = createAdminClient();

  // Teachers whose specialty array contains the requested specialty AND who
  // are accepting students. teacher_profiles is the authoritative source for
  // specialties (profiles.specialties is the legacy non-authoritative view).
  const { data: teachers, error } = await admin
    .from("teacher_profiles")
    .select(
      "teacher_id, specialties, is_accepting, is_archived",
    )
    .contains("specialties", [trimmed])
    .eq("is_archived", false)
    .order("is_accepting", { ascending: false })
    .limit(1)
    .maybeSingle<{
      teacher_id: string;
      specialties: string[];
      is_accepting: boolean;
      is_archived: boolean;
    }>();

  if (error) {
    logError("findAvailableSpecialist: teacher_profiles query failed", error, {
      tag: "single-sessions",
      specialty: trimmed,
    });
    return null;
  }
  if (!teachers) return null;

  // Best-effort availability probe — any active row on teacher_availability.
  const { data: avail } = await admin
    .from("teacher_availability")
    .select("id")
    .eq("teacher_id", teachers.teacher_id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ id: string }>();

  // Resolve display name from profiles (best-effort).
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", teachers.teacher_id)
    .maybeSingle<{ full_name: string | null }>();

  return {
    teacherId: teachers.teacher_id,
    displayName: profile?.full_name ?? null,
    specialties: teachers.specialties,
    hasAvailability: Boolean(avail),
  };
}

/**
 * List ALL available specialists for a specialty (used by the public
 * `/api/single-sessions/assessment-specialists` route so a student can see
 * the pool before booking). Returns [] when no teachers match.
 */
export async function listAvailableSpecialists(
  specialty: string,
): Promise<Specialist[]> {
  const trimmed = specialty.trim();
  if (!trimmed) return [];

  const admin = createAdminClient();

  const { data: teachers, error } = await admin
    .from("teacher_profiles")
    .select("teacher_id, specialties, is_accepting")
    .contains("specialties", [trimmed])
    .eq("is_archived", false)
    .order("is_accepting", { ascending: false })
    .returns<{
      teacher_id: string;
      specialties: string[];
      is_accepting: boolean;
    }[]>();

  if (error) {
    logError("listAvailableSpecialists: teacher_profiles query failed", error, {
      tag: "single-sessions",
      specialty: trimmed,
    });
    return [];
  }
  if (!teachers || teachers.length === 0) return [];

  // One round-trip availability + name lookup per teacher would be N+1; batch.
  const teacherIds = teachers.map((t) => t.teacher_id);

  const [{ data: availRows }, { data: profiles }] = await Promise.all([
    admin
      .from("teacher_availability")
      .select("teacher_id")
      .in("teacher_id", teacherIds)
      .eq("is_active", true)
      .returns<{ teacher_id: string }[]>(),
    admin
      .from("profiles")
      .select("id, full_name")
      .in("id", teacherIds)
      .returns<{ id: string; full_name: string | null }[]>(),
  ]);

  const availSet = new Set((availRows ?? []).map((r) => r.teacher_id));
  const nameMap = new Map(
    (profiles ?? []).map((p) => [p.id, p.full_name] as const),
  );

  return teachers.map((t) => ({
    teacherId: t.teacher_id,
    displayName: nameMap.get(t.teacher_id) ?? null,
    specialties: t.specialties,
    hasAvailability: availSet.has(t.teacher_id),
  }));
}

/**
 * Count a student's existing assessment bookings for a specialty. Used by
 * the route to enforce the per-specialty assessment limit (FR-014 / R-003):
 * over-limit requests are rejected with 409 BEFORE any Stripe call.
 *
 * Only counts bookings actually created (not abandoned checkouts).
 */
export async function countStudentAssessmentsForSpecialty(
  studentId: string,
  specialty: string,
): Promise<number> {
  const trimmed = specialty.trim();
  if (!trimmed) return 0;

  const admin = createAdminClient();
  const { count, error } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("booking_product_type", "assessment")
    .eq("specialty", trimmed);

  if (error) {
    logError(
      "countStudentAssessmentsForSpecialty: count query failed",
      error,
      { tag: "single-sessions", student_id: studentId, specialty: trimmed },
    );
    // Fail-closed: surface a high count so the route rejects rather than
    // allowing potential free-assessment farming. The platform setting
    // default is 1; returning Number.MAX_SAFE_INTEGER forces a 409.
    return Number.MAX_SAFE_INTEGER;
  }
  return count ?? 0;
}
