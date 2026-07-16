import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createConstrainedBooking,
  AssignmentNotFoundError,
  TeacherMismatchError,
  SlotAlreadyBookedError,
  SlotInstanceNotFoundError,
  TeacherUnavailableError,
} from "@/lib/domains/scheduling/bookings";
import { logError } from "@/lib/logger";

const bodySchema = z.object({
  slotInstanceId: z.string().uuid(),
});

/**
 * POST /api/scheduling/book-slot — create a booking constrained to the assigned teacher.
 * Auth required. `scheduled_at` is derived server-side from the locked
 * slot instance; clients cannot set it.
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
    // Malformed JSON → controlled 400 rather than an unhandled 500.
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = bodySchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json({ error: "Invalid request body", details: result.error.format() }, { status: 400 });
  }

  const { slotInstanceId } = result.data;

  try {
    const admin = createAdminClient();
    const bookingId = await createConstrainedBooking(
      supabase,
      admin,
      user.id,
      slotInstanceId,
    );

    return NextResponse.json({ bookingId }, { status: 201 });
  } catch (err) {
    if (err instanceof AssignmentNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof TeacherMismatchError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof SlotAlreadyBookedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof SlotInstanceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof TeacherUnavailableError) {
      // Spec 040 FR-029 dormant agreement gate — business rejection, not a 500.
      return NextResponse.json({ error: err.message }, { status: 403 });
    }

    logError("api/scheduling/book-slot: failed", err, {
      tag: "scheduling",
      user_id: user.id,
      slot_instance_id: slotInstanceId,
    });
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  }
}
