"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n/context";
import { isSafeRelativePath } from "@/lib/security/safe-url";
import { CONSENT_COOKIE, encodeConsentCookie, type ConsentMethod } from "@/lib/legal";

type Props = {
  next?: string;
  /** When true the button is inert — used by /register until the terms
   *  checkbox is ticked (consent gates BOTH signup paths, decision 43). */
  disabled?: boolean;
  /** How consent is expressed on the page hosting this button:
   *  "checkbox" (register clickwrap) or "notice" (login continue-implies-agreement).
   *  Recorded server-side by the OAuth callback via a short-lived cookie. */
  consentMethod?: ConsentMethod;
};

export function GoogleSignInButton({ next, disabled = false, consentMethod = "notice" }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { lang } = useLang();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);

  async function handleClick() {
    if (disabled) return;
    setPending(true);
    setError(null);

    // Carry consent through the OAuth round-trip. The callback route persists
    // it into app_metadata (tamper-resistant) and clears the cookie.
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${CONSENT_COOKIE}=${encodeConsentCookie(consentMethod)}; path=/; max-age=600; SameSite=Lax${secure}`;

    const callback = `${window.location.origin}/api/auth/callback/google`;
    const redirectTo = isSafeRelativePath(next)
      ? `${callback}?next=${encodeURIComponent(next)}`
      : callback;

    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });

    if (oauthError) {
      setError(
        t(
          "تعذر بدء تسجيل الدخول بحساب جوجل. حاول مرة أخرى.",
          "Could not start Google sign-in. Please try again.",
        ),
      );
      setPending(false);
    }
  }

  return (
    <div>
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg glass-danger p-3 text-sm text-error"
        >
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending || disabled}
        aria-disabled={pending || disabled}
        className="flex w-full items-center justify-center gap-3 rounded-full glass-pill border border-white/40 bg-white py-2.5 font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={t("تسجيل الدخول بحساب جوجل", "Sign in with Google")}
      >
        {pending ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
        ) : (
          <>
            <GoogleLogo />
            <span className="leading-none">
              الدخول بحساب جوجل
              <span className="ms-2 text-xs font-normal text-neutral-500">
                Continue with Google
              </span>
            </span>
          </>
        )}
      </button>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
