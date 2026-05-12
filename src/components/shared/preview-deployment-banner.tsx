import { cookies } from "next/headers";

/**
 * Preview deployment banner.
 *
 * Until Supabase Branching is enabled (blocked on Pro upgrade refusal —
 * see CLAUDE.md "Preview database isolation — known gap"), every Vercel
 * preview deployment shares the production Supabase project. Destructive
 * writes on a preview URL hit real prod data.
 *
 * This banner surfaces that reality at the top of every page when
 * VERCEL_ENV === "preview". It's dismissable per-session (cookie) so
 * teammates aren't fighting it on every navigation, but defaults to
 * visible.
 *
 * Production (VERCEL_ENV === "production") and local dev (undefined)
 * render nothing.
 */
export async function PreviewDeploymentBanner() {
  const env = process.env.VERCEL_ENV;
  if (env !== "preview") return null;

  const dismissed = (await cookies()).get("furqan-preview-banner-dismissed")?.value === "1";
  if (dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-0 z-[100] border-b border-red-500/40 bg-red-500/15 px-4 py-2 text-center text-xs font-medium text-red-100 backdrop-blur-md"
    >
      <span dir="auto">
        ⚠️ Preview deployment — connected to PRODUCTION database. Avoid
        creating, updating, or deleting data here.
      </span>
      <form action="/api/preview-banner/dismiss" method="post" className="inline-block ms-3">
        <button
          type="submit"
          className="rounded border border-red-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-red-100 hover:bg-red-500/20"
        >
          Dismiss for session
        </button>
      </form>
    </div>
  );
}
