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

  const body = await request.json();
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
      return NextResponse.json({ error: joinResult.error }, { status: 400 });
    }

    return NextResponse.json({ 
      membershipId: joinResult.membershipId, 
      classOfferingId: joinResult.classOfferingId, 
      overflowRedirected: joinResult.overflowRedirected 
    }, { status: 201 });
  } catch (err) {
    if (err instanceof EntryConditionError) {
      return NextResponse.json({ 
        success: false, 
        unmetCondition: err.unmetCondition 
      }, { status: 422 });
    }
    
    logError("api/scheduling/join-halaqa: failed", err, {});
    return NextResponse.json({ error: "Failed to join halaqa" }, { status: 500 });
  }
}
