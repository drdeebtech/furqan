import { NextResponse } from "next/server";

export async function GET(request: Request) {
  // TODO: List bookings for the authenticated user
  return NextResponse.json({ bookings: [] });
}

export async function POST(request: Request) {
  // TODO: Create a new booking
  return NextResponse.json({ booking: null });
}
