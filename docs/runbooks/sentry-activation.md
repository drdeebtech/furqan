# Sentry — activating in production

> One-time setup. Extracted from `CLAUDE.md` on 2026-05-12.
> The active operational gotcha (Sentry GitHub auto-resolve currently broken)
> stays in `CLAUDE.md` because it affects every fix-PR commit.

The Sentry SDK is fully scaffolded (`@sentry/nextjs@10.49.0`, three config files at the repo root, `logError` routes through `Sentry.captureException` when DSN is set). Activation is a 5-minute task:

1. Create a free Sentry account at https://sentry.io/signup/ — pick the **Next.js** platform when prompted.
2. Sentry shows you a DSN that looks like `https://xxxx@oNNNN.ingest.sentry.io/PPPP`. Copy it.
3. In Vercel → furqan project → Settings → Environment Variables, add:
   - `SENTRY_DSN` = (the DSN, all environments)
   - `NEXT_PUBLIC_SENTRY_DSN` = (same value, all environments — used by client SDK)
4. Trigger a redeploy (push any commit, or click "Redeploy" on the latest Vercel deployment).
5. Verify by intentionally throwing in any server action — the error should appear in Sentry within ~30 seconds.

Until DSN is set, `logError` falls back to `console.error` in dev and Telegram alerts on `severity: 'critical'`. No-op behavior in production keeps the app running normally.
