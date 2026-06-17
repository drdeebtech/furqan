import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabaseResponse } = await updateSession(request);
  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on all paths EXCEPT:
    //   _next/static  — compiled assets
    //   _next/image   — image optimiser
    //   favicon.ico   — browser built-in
    //   api/auth      — Google OAuth callback + logout must not be intercepted
    //   common static — svg/png/jpg/jpeg/gif/webp
    "/((?!_next/static|_next/image|favicon\\.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
