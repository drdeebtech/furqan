/**
 * Per-request Content-Security-Policy for HTML responses.
 *
 * `script-src` uses a cryptographic nonce (set on the request as `x-nonce`
 * and mirrored here) so Next.js can emit its bootstrap/hydration inline
 * scripts without `'unsafe-inline'`. Third-party origins stay on the
 * allowlist for classic `src=` loads (Stripe, Supabase, Daily, Vercel).
 *
 * @see https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
 */
export function buildContentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const scriptEval = isDev ? " 'unsafe-eval'" : "";

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://*.supabase.co https://*.daily.co https://js.stripe.com https://checkout.stripe.com https://vercel.live https://us-assets.i.posthog.com${scriptEval}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `img-src 'self' data: blob: https://*.supabase.co https://*.daily.co https://*.b-cdn.net${process.env.BUNNY_STORAGE_HOSTNAME ? ` https://${process.env.BUNNY_STORAGE_HOSTNAME}` : ""} https://vercel.live https://vercel.com`,
    "font-src 'self' data: https://fonts.gstatic.com https://assets.vercel.com",
    // wss://*.supabase.co: Supabase Realtime WebSocket (spec 032)
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.daily.co wss://*.daily.co https://n8n.drdeeb.tech https://api.stripe.com https://*.ingest.sentry.io https://video.bunnycdn.com https://*.b-cdn.net https://vercel.live wss://ws-us3.pusher.com https://us.i.posthog.com https://us-assets.i.posthog.com",
    "report-uri https://o4511287545954304.ingest.de.sentry.io/api/4511305365323856/security/?sentry_key=e75e135004c761a09b8c2c013d095686",
    "frame-src https://*.daily.co https://checkout.stripe.com https://js.stripe.com https://vercel.live",
    "media-src 'self' blob: https://*.daily.co https://*.b-cdn.net",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Clickjacking guard that rides on the per-request CSP header, so it holds
    // on every deployment surface (Vercel AND any VPS/self-hosted build where
    // vercel.json's X-Frame-Options is inert). Modern replacement for XFO.
    "frame-ancestors 'self'",
  ].join("; ");
}
