import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { joinHalaqa, EntryConditionError } from "@/lib/domains/scheduling/cohorts";
import { logError } from "@/lib/logger";

const bodySchema = z.object({
  classOfferingId: z.string().uuid(),
  entryConfirmation: z.string().optional(),
});

/**
 * POST /api/scheduling/join-halaqa — join a group halaqa or course.
 * Handles overflow redirection and entry conditions.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const { classOfferingId, entryConfirmation } = result.data;

  try {
    const admin = createAdminClient();
    const joinResult = await joinHalaqa(
      supabase,
      admin,
      user.id,
      classOfferingId,
      entryConfirmation
    );

    if (!joinResult.ok) {
      // Map known domain failures to semantically correct HTTP status codes
      // instead of a blanket 400. The error strings are the contract with
      // the client; status codes are the contract with HTTP semantics.
      const error = joinResult.error;
      let status = 400;
      if (error.includes("not found")) status = 404;
      else if (error.includes("already a member")) status = 409;
      else if (error.includes("Failed to")) status = 500;
      return NextResponse.json({ error }, { status });
    }

    return NextResponse.json({
      membershipId: joinResult.membershipId,
      classOfferingId: joinResult.classOfferingId,
      overflowRedirected: joinResult.overflowRedirected,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof EntryConditionError) {
      return NextResponse.json({
        error: err.message,
        unmetCondition: err.unmetCondition,
      }, { status: 422 });
    }

    logError("api/scheduling/join-halaqa: failed", err, {
      tag: "scheduling",
      user_id: user.id,
      class_offering_id: classOfferingId,
    });
    return NextResponse.json({ error: "Failed to join halaqa" }, { status: 500 });
  }
}
