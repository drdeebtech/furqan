import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoleForApi } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { scheduleRenewalChange } from "@/lib/domains/catalog/tier-changes";
import { logError } from "@/lib/logger";

/**
 * POST /api/subscriptions/schedule-tier-change — Spec 019 US5 T023.
 *
 * Schedules a deferred tier change for the next renewal cycle.
 * Inserts a `pending_tier_changes` row; any existing pending row for this
 * subscription is cancelled first (upsert semantics in scheduleRenewalChange).
 *
 * Auth: student role only. Subscription ownership verified by student_id = userId.
 */

const VALID_REASONS = ["type_change", "teacher_change", "downgrade", "other"] as const;

const Body = z.object({
  subscriptionId: z.uuid(),
  toPackageId: z.uuid(),
  changeReason: z.enum(VALID_REASONS).default("other"),
});

export async function POST(request: Request) {
  const g = await requireRoleForApi("student");
  if (g instanceof NextResponse) return g;
  const userId = g.id;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid body: { subscriptionId, toPackageId, changeReason? } required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Verify ownership.
  const { data: sub, error: subErr } = await admin
    .from("subscriptions")
    .select("id, plan_id, student_id")
    .eq("id", parsed.subscriptionId)
    .eq("student_id", userId)
    .not("status", "in", "(canceled,incomplete_expired)")
    .maybeSingle();

  if (subErr || !sub) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  // Verify target package exists and is a hifz product.
  const { data: targetPkg, error: targetErr } = await admin
    .from("packages")
    .select("id, subscription_plan_id")
    .eq("id", parsed.toPackageId)
    .eq("is_hifz_product", true)
    .maybeSingle();

  if (targetErr) {
    logError("schedule-tier-change: target package lookup failed", targetErr, {
      tag: "billing",
      subscription_id: parsed.subscriptionId,
    });
    return NextResponse.json({ error: "Failed to verify target package" }, { status: 500 });
  }
  if (!targetPkg) {
    return NextResponse.json({ error: "Target package not found" }, { status: 404 });
  }
  // Resolve current package for the from_package_id (hifz only).
  const { data: currentPkg, error: currentPkgErr } = await admin
    .from("packages")
    .select("id")
    .eq("subscription_plan_id", sub.plan_id)
    .eq("is_hifz_product", true)
    .maybeSingle();

  if (currentPkgErr) {
    logError("schedule-tier-change: current package lookup failed", currentPkgErr, {
      tag: "billing",
      subscription_id: parsed.subscriptionId,
    });
    return NextResponse.json({ error: "Failed to resolve current package" }, { status: 500 });
  }

  // 422 rather than substituting sub.id (a subscriptions UUID ≠ packages UUID);
  // that would either corrupt the FK or trigger a 23503 violation silently (M-2).
  if (!currentPkg) {
    return NextResponse.json(
      { error: "Current subscription has no associated package" },
      { status: 422 },
    );
  }

  if (targetPkg.id === currentPkg.id) {
    return NextResponse.json({ error: "Already on this tier" }, { status: 422 });
  }

  const scheduled = await scheduleRenewalChange(admin, {
    subscriptionId: sub.id,
    studentId: userId,
    fromPackageId: currentPkg.id,
    toPackageId: parsed.toPackageId,
    changeReason: parsed.changeReason,
  });

  if (!scheduled) {
    logError("schedule-tier-change: scheduleRenewalChange returned null", new Error("scheduleRenewalChange null"), {
      tag: "billing",
      subscription_id: sub.id,
    });
    return NextResponse.json({ error: "Failed to schedule tier change" }, { status: 500 });
  }

  return NextResponse.json({ result: "scheduled", pendingId: scheduled.id }, { status: 201 });
}
