import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Magic-link confirmation endpoint.
 *
 * Hit by:
 *   - The remote-handoff flow (`/api/auth/handoff/[code]` → here)
 *   - Any future passwordless / recovery-link surface
 *
 * Calls `supabase.auth.verifyOtp({ token_hash, type })` which sets the auth
 * cookies via the @supabase/ssr cookie adapter (configured in
 * `src/lib/supabase/server.ts`), then 302s to `next`.
 *
 * `next` is re-validated here as defense-in-depth: even though the
 * remote-handoff flow already validated `target_path` at insert and again
 * via the DB CHECK constraint, this endpoint may be reached from other
 * surfaces in the future, so the gate stays.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = url.searchParams.get("next") || "/";

  if (!tokenHash || type !== "magiclink") {
    return NextResponse.json({ error: "Invalid confirmation request" }, { status: 400 });
  }

  // Open-redirect guard. Only allow same-origin paths under /admin/, /student/,
  // /teacher/, /moderator/, or the root. Reject anything else.
  const safeNext = isSafeNext(next) ? next : "/";

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });

  if (error) {
    logError("auth/confirm: verifyOtp failed", error, { tag: "auth-confirm" });
    Sentry.addBreadcrumb?.({
      category: "auth",
      level: "error",
      message: "auth.confirm.failed",
      data: { code: error.code ?? null },
    });
    return NextResponse.redirect(new URL("/login?error=link_expired", url.origin), 302);
  }

  Sentry.addBreadcrumb?.({
    category: "auth",
    level: "info",
    message: "auth.confirm.ok",
  });

  return NextResponse.redirect(new URL(safeNext, url.origin), 302);
}

function isSafeNext(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (/[\r\n\x00\\]/.test(path)) return false;
  if (path.split("/").includes("..")) return false;
  return /^\/(admin|student|teacher|moderator)?(\/|$|\?)/.test(path);
}
