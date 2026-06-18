import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { submitExcuse } from "@/lib/domains/attendance/excuses";
import { logError } from "@/lib/logger";

const bodySchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().min(3).max(2000),
});

/**
 * POST /api/excuses/submit — student submits an excuse for an upcoming session.
 * Eligibility computed from the excuse_notice_threshold_seconds setting.
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

  try {
    const { excuseId, isEligible } = await submitExcuse(supabase, {
      bookingId: result.data.bookingId,
      reason: result.data.reason,
      userId: user.id,
    });
    return NextResponse.json({ excuseId, isEligible }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit excuse";
    logError("api/excuses/submit: failed", err, {
      tag: "attendance",
      user_id: user.id,
      booking_id: result.data.bookingId,
    });
    // Distinguish "not your booking" / "already exists" as 4xx from infra errors.
    const status =
      message.includes("not found") || message.includes("Not your") || message.includes("already") ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
