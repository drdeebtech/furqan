import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRoleForApi } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

/**
 * GET /api/guardian/children — Spec 019 US4 T017.
 *
 * Returns all children linked to the authenticated guardian.
 * Service-role client for the join — RLS would block cross-profile reads.
 */
export async function GET() {
  const g = await requireRoleForApi("guardian");
  if (g instanceof NextResponse) return g;
  const userId = g.id;

  // admin: authed guardian; joins guardian_children → profiles (RLS would block cross-profile reads) (issue #523)
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
    logError("guardian/children: fetch failed", error, { tag: "guardian" });
    return NextResponse.json({ error: "Failed to fetch children" }, { status: 500 });
  }

  const children = (links ?? []).map((link) => {
    const profile = link.profiles;
    return {
      id: link.child_id,
      full_name: profile?.full_name ?? null,
      full_name_ar: profile?.full_name_ar ?? null,
      avatar_url: profile?.avatar_url ?? null,
    };
  });

  return NextResponse.json({ children });
}
