"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
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
  // 1. fetch course (verify published + paid)
  // 2. compute platform_fee_cents = round(price_cents * 0.30)
  // 3. compute teacher_earnings_cents = price_cents - platform_fee_cents
  // 4. create Stripe Checkout Session with metadata { courseId, studentId }
  // 5. return checkout_url
  return {
    ok: false as const,
    error: "Stripe checkout will land in Stage 11",
    courseId,
  };
}
