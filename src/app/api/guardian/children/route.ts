import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/require-admin";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";

/**
 * GET /api/guardian/children — Spec 019 US4 T017.
 *
 * Returns all children linked to the authenticated guardian.
 * Service-role client for the join — RLS would block cross-profile reads.
 */
export async function GET() {
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

  const { data: links, error } = await admin
    .from("guardian_children")
    .select(
      `
      child_id,
      profiles!guardian_children_child_id_fkey (
        id,
        full_name,
        full_name_ar,
        avatar_url
      )
    `,
    )
    .eq("guardian_id", userId);

  if (error) {
    return NextResponse.json({ error: "Failed to fetch children" }, { status: 500 });
  }

  const children = (links ?? []).map((link) => {
    const profile = Array.isArray(link.profiles) ? link.profiles[0] : link.profiles;
    return {
      id: link.child_id,
      full_name: profile?.full_name ?? null,
      full_name_ar: profile?.full_name_ar ?? null,
      avatar_url: profile?.avatar_url ?? null,
    };
  });

  return NextResponse.json({ children });
}
