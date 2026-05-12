# Supabase Auth — leaked password protection

> One-time setup. Extracted from `CLAUDE.md` on 2026-05-12.

Supabase Auth can reject passwords known to be in the HaveIBeenPwned breach corpus. This is **off by default** and cannot be migrated — it's a dashboard toggle. Enable once per environment:

1. Supabase Dashboard → **Authentication** → **Providers** → **Email** (or the project's auth settings page).
2. Find **Leaked password protection** (sometimes labeled "HaveIBeenPwned check").
3. Toggle on. Save.
4. Verify by attempting to register / reset with a known-pwned password (e.g. `password123`) — the request must be rejected.
5. Verify via Dashboard → Advisors — the `auth_leaked_password_protection` finding should be gone. (Do **not** use `mcp__claude_ai_Supabase__*` here — see the Supabase MCP wrong-account gotcha in `CLAUDE.md`.)

Docs: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
