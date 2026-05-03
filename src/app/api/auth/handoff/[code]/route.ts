import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { consumeHandoff } from "@/lib/auth/remote-handoff";

export const dynamic = "force-dynamic";

/**
 * Phone scans the QR → lands here. We atomically claim the row, then 302
 * through `/auth/confirm` which sets the auth cookie via Supabase's verifyOtp.
 *
 * The phone never sees the raw token_hash — that lives only in the
 * Location header of the immediate next hop, which is server-issued.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  // Forwarded IP behind Vercel's edge proxy lives in `x-forwarded-for`;
  // first comma-separated value is the original client.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const ua = request.headers.get("user-agent") || null;

  const result = await consumeHandoff(code, ip, ua);

  if (!result.ok) {
    Sentry.addBreadcrumb?.({
      category: "auth",
      level: "warning",
      message: "remote-handoff.consume.rejected",
      data: { status: result.status },
    });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  Sentry.addBreadcrumb?.({
    category: "auth",
    level: "info",
    message: "remote-handoff.consume.ok",
  });

  // Build /auth/confirm URL on the same origin so the cookie set by Supabase
  // lands on the right host.
  const origin = new URL(request.url).origin;
  const confirmUrl = new URL("/auth/confirm", origin);
  confirmUrl.searchParams.set("token_hash", result.tokenHash);
  confirmUrl.searchParams.set("type", "magiclink");
  confirmUrl.searchParams.set("next", result.nextPath);

  return NextResponse.redirect(confirmUrl, 302);
}
