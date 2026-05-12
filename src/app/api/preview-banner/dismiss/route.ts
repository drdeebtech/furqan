import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Dismiss the preview-deployment warning banner for the current session.
 * Sets a cookie that the banner component reads on next render. Session
 * scope only — closing the browser brings the banner back.
 */
export async function POST(request: Request) {
  (await cookies()).set("furqan-preview-banner-dismissed", "1", {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
  });

  // Validate referer to prevent open redirect and CSRF attacks.
  // Only allow redirecting to same-origin URLs.
  const referer = request.headers.get("referer");
  const requestUrl = new URL(request.url);
  let redirectUrl = new URL("/", requestUrl);

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      // Only redirect to same origin (same protocol + host)
      if (
        refererUrl.origin === requestUrl.origin
      ) {
        redirectUrl = refererUrl;
      }
    } catch {
      // Invalid URL in referer header — ignore it and use fallback
    }
  }

  return NextResponse.redirect(redirectUrl);
}
