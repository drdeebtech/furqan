import { NextResponse } from "next/server";

export async function POST(request: Request) {
  // TODO: Create a Daily.co room for a session
  return NextResponse.json({ room: null });
}
