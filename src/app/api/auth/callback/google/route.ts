import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { isSafeRelativePath } from "@/lib/security/safe-url";
import { CONSENT_COOKIE, parseConsentCookie } from "@/lib/legal";

/**
 * Persist terms/privacy consent for OAuth-created sessions (Wave 0, decision 43).
 *
 * The initiating page (register checkbox / login notice) sets a short-lived
 * cookie before the Google redirect; we copy it into app_metadata — which only
 * the service role can write, so the record is tamper-resistant — exactly once.
 * Fail-soft: consent bookkeeping must never break a login, but failures are
 * logged loudly. The caller clears the cookie on the redirect response.
 */
async function recordOAuthConsent(
  request: NextRequest,
  userId: string,
  existingConsent: unknown,
): Promise<void> {
  const cookieValue = request.cookies.get(CONSENT_COOKIE)?.value;
  if (existingConsent) return; // already recorded at first signup — keep the original
  const consent = parseConsentCookie(cookieValue);
  if (!consent) {
    // Gated buttons always set the cookie; absence means an unexpected entry
    // path (deep link, cleared cookies). Log for visibility — never fabricate.
    logError(
      "OAuth signup completed without a consent cookie",
      new Error("oauth.consent.cookie_missing"),
      { tag: "auth-consent-record-failed", metadata: { userId } },
    );
    return;
  }
  // Fail-soft: createAdminClient() (missing env, etc.) or the update can throw;
  // a consent-bookkeeping failure must never turn into a failed Google login.
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { consent },
    });
    if (error) {
      logError("Failed to record OAuth consent in app_metadata", error, {
        tag: "auth-consent-record-failed",
        metadata: { userId },
      });
    }
  } catch (err) {
    logError("Failed to record OAuth consent in app_metadata", err, {
      tag: "auth-consent-record-failed",
      metadata: { userId },
    });
  }
}

/** Clear the short-lived consent cookie on any redirect out of the callback. */
function clearConsentCookie(res: NextResponse): NextResponse {
  res.cookies.set(CONSENT_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

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
    return clearConsentCookie(NextResponse.redirect(`${origin}/login?error=oauth_missing_code`));
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
      return clearConsentCookie(NextResponse.redirect(`${origin}/login?error=oauth_exchange_failed`));
    }

    // Resolve role so we can redirect the user to the right dashboard.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return clearConsentCookie(NextResponse.redirect(`${origin}/login?error=oauth_no_user`));
    }

    // Consent bookkeeping (fail-soft, awaited so the record lands before the
    // redirect; a failure only logs). app_metadata.consent survives from the
    // first signup — never overwritten.
    await recordOAuthConsent(request, user.id, user.app_metadata?.consent);

    // If the initiating page requested a specific redirect, honour it —
    // but only for safe relative paths (guards against open-redirect attacks,
    // including the `/\evil.com` backslash bypass).
    if (isSafeRelativePath(next)) {
      return clearConsentCookie(NextResponse.redirect(`${origin}${next}`));
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role: string }>();

    const role = profile?.role ?? "student";

    return clearConsentCookie(NextResponse.redirect(`${origin}/${role}/dashboard`));
  } catch (err) {
    logError("Google OAuth callback unexpected error", err, {
      tag: "auth-google-callback",
    });
    return clearConsentCookie(NextResponse.redirect(`${origin}/login?error=oauth_unexpected`));
  }
}