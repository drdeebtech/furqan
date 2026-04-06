import { NextResponse } from "next/server";

export async function POST(_request: Request) {
  // TODO: Verify Stripe webhook signature and handle events
  return NextResponse.json({ received: true });
}
