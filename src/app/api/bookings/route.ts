import { NextResponse } from "next/server";

export async function GET(_request: Request) {
  // TODO: List bookings for the authenticated user
  return NextResponse.json({ bookings: [] });
}

export async function POST(_request: Request) {
  // TODO: Create a new booking
  return NextResponse.json({ booking: null });
}
