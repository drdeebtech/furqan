import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-admin";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";

export const maxDuration = 30;

const Query = z.object({
  productType: z.enum(["assessment", "instant", "specialized"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/single-sessions/my-bookings
 *
 * Spec 022 contracts §4: returns the caller's single-session bookings
 * (assessment / instant / specialized). Identity from the session only
 * (FR-005); RLS guarantees a student reads ONLY their own rows — the
 * `student_id` filter is belt-and-suspenders, never a trust boundary.
 *
 * Bookings created via the atomic creator ship with `sessions.scheduled_at`
 * NULL — the student chooses the slot in a separate follow-up step
 * (data-model §3). `scheduledAt: null` in the response means "pending
 * scheduling".
 */
export async function GET(request: Request) {
  let authed: { id: string };
  try {
    authed = await requireRole("student");
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "Only students may view their bookings" }, { status: 403 });
    }
    throw e;
  }

  const url = new URL(request.url);
  const parsed = Query.safeParse({
    productType: url.searchParams.get("productType") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // Single-session product types this route surfaces; narrow to the requested
  // one when productType is provided (zod-validated to be one of these three),
  // avoiding a redundant second filter.
  const productTypes = parsed.data.productType
    ? [parsed.data.productType]
    : ["assessment", "instant", "specialized"];

  // Count total for pagination metadata.
  const countQuery = supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("student_id", authed.id)
    .in("booking_product_type", productTypes);
  const { count, error: countErr } = await countQuery;
  if (countErr) {
    return NextResponse.json({ error: "Failed to count bookings" }, { status: 500 });
  }

  let dataQuery = supabase
    .from("bookings")
    .select(
      "id, booking_product_type, specialty, purpose, target_scope, teacher_id, status, session_id, student_package_id",
    )
    .eq("student_id", authed.id)
    .in("booking_product_type", ["assessment", "instant", "specialized"])
    .order("created_at", { ascending: false })
    .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1);
  if (parsed.data.productType) {
    dataQuery = dataQuery.eq("booking_product_type", parsed.data.productType);
  }
  const { data: bookings, error } = await dataQuery.returns<{
    id: string;
    booking_product_type: string;
    specialty: string | null;
    purpose: string | null;
    target_scope: unknown;
    teacher_id: string;
    status: string;
    session_id: string | null;
    student_package_id: string | null;
  }[]>();

  if (error) {
    return NextResponse.json({ error: "Failed to load bookings" }, { status: 500 });
  }

  // Resolve scheduledAt via sessions + paymentId via payments.booking_id.
  const bookingRows = (bookings ?? []) as Array<{
    id: string;
    booking_product_type: string;
    specialty: string | null;
    purpose: string | null;
    target_scope: unknown;
    teacher_id: string;
    status: string;
    session_id: string | null;
    student_package_id: string | null;
  }>;
  const sessionIds = bookingRows.map((b) => b.session_id).filter((s): s is string => Boolean(s));
  let sessions: Array<{ booking_id: string; scheduled_at: string | null }> = [];
  if (sessionIds.length > 0) {
    const { data: sessRows } = await supabase
      .from("sessions")
      .select("booking_id, scheduled_at")
      .in("id", sessionIds);
    sessions = (sessRows ?? []) as Array<{ booking_id: string; scheduled_at: string | null }>;
  }
  const scheduledByBooking = new Map(sessions.map((s) => [s.booking_id, s.scheduled_at]));

  const bookingIds = bookingRows.map((b) => b.id);
  let payments: Array<{ booking_id: string; id: string }> = [];
  if (bookingIds.length > 0) {
    const { data: payRows } = await supabase
      .from("payments")
      .select("booking_id, id")
      .in("booking_id", bookingIds)
      .not("booking_id", "is", null);
    payments = (payRows ?? []) as Array<{ booking_id: string; id: string }>;
  }
  const paymentByBooking = new Map(payments.map((p) => [p.booking_id, p.id]));

  return NextResponse.json({
    success: true,
    data: bookingRows.map((b) => ({
      bookingId: b.id,
      productType: b.booking_product_type as "assessment" | "instant" | "specialized",
      specialty: b.specialty,
      purpose: b.purpose,
      targetScope: (b.target_scope ?? undefined) as object | undefined,
      teacherId: b.teacher_id,
      scheduledAt: b.session_id ? (scheduledByBooking.get(b.id) ?? null) : null,
      status: b.status,
      paymentId: paymentByBooking.get(b.id) ?? null,
    })),
    pagination: {
      total: count ?? 0,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    },
  });
}
