"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import { notify } from "@/lib/notifications/dispatcher";
import { isFeatureEnabled } from "@/lib/settings";

// ─── enrollFree ─────────────────────────────────────────────────────────────
// Free path: only allowed when course.pricing_type='free' and course.status='published'.
// RLS already enforces both, but we also check defensively in the action so we
// can return a friendly error instead of letting Postgres throw.

export async function enrollFree(courseId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "غير مسجل الدخول" };

  const { data: course } = await supabase
    .from("courses")
    .select("id, status, pricing_type")
    .eq("id", courseId)
    .single<{ id: string; status: string; pricing_type: string }>();

  if (!course) return { ok: false as const, error: "الدورة غير موجودة" };
  if (course.status !== "published") {
    return { ok: false as const, error: "الدورة غير متاحة للاشتراك" };
  }
  if (course.pricing_type !== "free") {
    return { ok: false as const, error: "هذه الدورة غير مجانية" };
  }

  const { error } = await supabase
    .from("course_enrollments")
    .insert({
      student_id: user.id,
      course_id: courseId,
      source: "free",
      currency: "USD",
    } as never);

  if (error) {
    if (error.code === "23505") {
      // Already enrolled — treat as success
      return { ok: true as const };
    }
    logError("enrollFree failed", error, { tag: "course-enrollments", courseId });
    return { ok: false as const, error: error.message };
  }

  // Bump course's enrollment count
  await supabase.rpc("noop" as never).then(async () => {
    const { count } = await supabase
      .from("course_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId);
    if (count !== null) {
      await supabase
        .from("courses")
        .update({ enrollment_count_cached: count } as never)
        .eq("id", courseId);
    }
  });

  await emitEvent("course.enrolled", "course", courseId, {
    student_id: user.id,
    source: "free",
  }, user.id).catch((err) =>
    logError("emit course.enrolled failed", err, { tag: "course-enrollments", courseId }),
  );

  // Notify the teacher of the new enrollment when there is one.
  // Platform-owned courses have no teacher attached — the admin digest
  // covers those.
  const { data: courseRow } = await supabase
    .from("courses")
    .select("teacher_id, title_ar")
    .eq("id", courseId)
    .single<{ teacher_id: string | null; title_ar: string }>();
  const { data: studentProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single<{ full_name: string | null }>();
  if (courseRow?.teacher_id) {
    await notify(
      courseRow.teacher_id,
      "course",
      "اشتراك جديد",
      `${studentProfile?.full_name ?? "طالب"} اشترك في "${courseRow.title_ar}"`,
      "course",
      courseId,
    ).catch((err) =>
      logError("notify on enroll failed", err, { tag: "course-enrollments", courseId }),
    );
  }

  revalidatePath(`/student/courses`);
  revalidatePath(`/courses`);
  return { ok: true as const };
}

// ─── initiateEnrollmentCheckout ─────────────────────────────────────────────
// Paid path. When paid_courses_enabled feature flag is off, returns a clear
// "soon" error instead of breaking. When on, will create a Stripe Checkout
// Session (Stage 11). For now this is the placeholder.

export async function initiateEnrollmentCheckout(courseId: string) {
  const enabled = await isFeatureEnabled("paid_courses_enabled");
  if (!enabled) {
    return {
      ok: false as const,
      error: "الدفع قيد التحضير — قريباً نتيح شراء الدورات المدفوعة",
    };
  }

  // TODO Stage 11: create Stripe Checkout Session
  // 1. fetch course (verify published + paid). Read at least:
  //    price_cents, currency, ownership, teacher_revenue_share_bps.
  // 2. compute the split via computeCourseRevenueSplit() in
  //    src/lib/courses/revenue-split.ts — that helper is the single source
  //    of truth for cents-exact platform-vs-teacher math and is shared
  //    with the post-payment enrollment-insert path. Platform-owned
  //    courses produce { platformFeeCents: priceCents, teacherEarningsCents: 0 }.
  // 3. create Stripe Checkout Session with metadata { courseId, studentId }.
  // 4. on webhook success, insert into course_enrollments with the snapshot
  //    fields { amount_paid_cents, platform_fee_cents, teacher_earnings_cents,
  //    currency, source: 'purchase', payment_id }.
  // 5. return checkout_url.
  return {
    ok: false as const,
    error: "Stripe checkout will land in Stage 11",
    courseId,
  };
}
