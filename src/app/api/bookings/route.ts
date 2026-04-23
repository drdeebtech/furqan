import { NextResponse } from "next/server";

/**
 * Stub endpoint — NOT YET IMPLEMENTED.
 * Returns 501 instead of an empty array so that:
 *   - accidental clients see a clear error
 *   - a future dev cannot silently ship the handler without auth — they must
 *     replace this body, which forces them to think about auth
 *
 * When implementing: add getUser() check + RLS-friendly query scoped to
 * student_id = user.id.
 */
export async function GET() {
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}

export async function POST() {
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}
