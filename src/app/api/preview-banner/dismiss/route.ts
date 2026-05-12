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

  const referer = request.headers.get("referer");
  return NextResponse.redirect(referer ?? new URL("/", request.url));
}
