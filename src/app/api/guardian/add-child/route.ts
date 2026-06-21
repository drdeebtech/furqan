import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/require-admin";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import { logError } from "@/lib/logger";

/**
 * POST /api/guardian/add-child — Spec 019 US4 T018.
 *
 * Links a child to the authenticated guardian by email.
 * Uses service-role to resolve child user-id and insert into guardian_children
 * (RLS blocks authenticated inserts to that table).
 *
 * Idempotent: re-linking an already-linked child returns 200 (not 409).
 */

const Body = z.object({
  childEmail: z.email(),
});

export async function POST(request: Request) {
  let userId: string;
  try {
    ({ id: userId } = await requireRole("guardian"));
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw e;
  }

  const admin = createAdminClient();

  // Per-guardian rate limit (audit H-1): blunts the email-enumeration/abuse
  // vector. Keyed on the authenticated guardian id, not client IP — the
  // endpoint is auth-gated, so userId is the trustworthy throttle key.
  const { data: rateAllowed } = await (
    admin.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: boolean | null }>
  )("check_and_increment_rate_limit", {
    p_bucket: "guardian_add_child",
    p_identifier: userId,
    p_max: 20,
    p_window_seconds: 3600,
  });
  if (rateAllowed === false) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch (e) {
    logError("add-child: invalid request body", e, { tag: "guardian", guardian_id: userId });
    return NextResponse.json(
      { error: "Invalid body: { childEmail: string } required" },
      { status: 400 },
    );
  }

  const { data: childId, error: lookupErr } = await admin.rpc("get_user_id_by_email", {
    p_email: parsed.childEmail,
  });

  if (lookupErr) {
    logError("add-child: get_user_id_by_email failed", lookupErr, {
      tag: "guardian",
      guardian_id: userId,
    });
    return NextResponse.json({ error: "Failed to resolve child email" }, { status: 500 });
  }

  if (!childId) {
    // 422 not 404 — uniform response prevents email-existence enumeration (H-1).
    return NextResponse.json({ error: "Invalid child account" }, { status: 422 });
  }

  if (childId === userId) {
    return NextResponse.json({ error: "Cannot add yourself as a child" }, { status: 422 });
  }

  // Verify the resolved account is a student (prevents linking teacher/admin accounts).
  const { data: childProfile, error: childProfileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", childId as string)
    .maybeSingle();

  if (childProfileErr) {
    logError("add-child: child profile lookup failed", childProfileErr, {
      tag: "guardian",
      guardian_id: userId,
      child_id: childId,
    });
    return NextResponse.json({ error: "Failed to verify child account" }, { status: 500 });
  }

  if (childProfile?.role !== "student") {
    return NextResponse.json({ error: "Invalid child account" }, { status: 422 });
  }

  const { error: insertErr } = await admin.from("guardian_children").insert({
    guardian_id: userId,
    child_id: childId as string,
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ ok: true });
    }
    logError("add-child: insert failed", insertErr, {
      tag: "guardian",
      guardian_id: userId,
      child_id: childId,
    });
    return NextResponse.json({ error: "Failed to add child" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
