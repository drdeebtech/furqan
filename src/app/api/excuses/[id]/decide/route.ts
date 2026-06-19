import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideExcuse, ExcuseAuthorizationError, ExcuseAlreadyDecidedError, ExcuseNotEligibleError } from "@/lib/domains/attendance/excuses";
import { logError } from "@/lib/logger";

const bodySchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
});

/**
 * PATCH /api/excuses/[id]/decide — teacher or admin accepts/rejects an excuse.
 * Accepting an eligible excuse triggers the carry-over path (credit restore +
 * subscription extension). Emits a domain event for spec 023 notifications.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: excuseId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = bodySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: "Invalid request body", details: result.error.format() }, { status: 400 });
  }

  // Resolve role: admin or teacher? Profiles lookup.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  const isAdmin = profile?.role === "admin";

  try {
    const admin = createAdminClient();
    const { carried } = await decideExcuse(admin, {
      excuseId,
      decision: result.data.decision,
      deciderId: user.id,
      isAdmin,
    });
    return NextResponse.json({ ok: true, carried }, { status: 200 });
  } catch (err) {
    if (err instanceof ExcuseAuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof ExcuseAlreadyDecidedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ExcuseNotEligibleError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    logError("api/excuses/decide: failed", err, {
      tag: "attendance",
      user_id: user.id,
      excuse_id: excuseId,
    });
    return NextResponse.json({ error: "Failed to decide excuse" }, { status: 500 });
  }
}
