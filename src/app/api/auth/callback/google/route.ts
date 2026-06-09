import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { isSafeRelativePath } from "@/lib/security/safe-url";

/**
 * Google OAuth callback handler.
 *
 * Supabase redirects users here after they complete the Google OAuth consent
 * screen. We exchange the one-time `code` for a session, resolve the user's
 * role, and redirect them to their role-specific dashboard.
 *
 * On any failure we send the user back to /login with a descriptive error
 * query param so they get a readable message rather than a blank screen.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    logError(
      "Google OAuth callback missing code param",
      new Error("oauth.callback.missing_code"),
      { tag: "auth-google-callback" },
    );
    return NextResponse.redirect(`${origin}/login?error=oauth_missing_code`);
  }

  try {
    const supabase = await createClient();

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      logError("Google OAuth code exchange failed", error, {
        tag: "auth-google-callback",
        metadata: {
          supabaseCode: (error as { code?: string }).code,
          supabaseMessage: error.message,
        },
      });
      return NextResponse.redirect(`${origin}/login?error=oauth_exchange_failed`);
    }

    // Resolve role so we can redirect the user to the right dashboard.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(`${origin}/login?error=oauth_no_user`);
    }

    // If the initiating page requested a specific redirect, honour it —
    // but only for safe relative paths (guards against open-redirect attacks,
    // including the `/\evil.com` backslash bypass).
    if (isSafeRelativePath(next)) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role: string }>();

    const role = profile?.role ?? "student";

    return NextResponse.redirect(`${origin}/${role}/dashboard`);
  } catch (err) {
    logError("Google OAuth callback unexpected error", err, {
      tag: "auth-google-callback",
    });
    return NextResponse.redirect(`${origin}/login?error=oauth_unexpected`);
  }
}