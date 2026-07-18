# Dev/Prod Supabase Isolation

**TL;DR — never run write-path tests against the production Supabase project.**

During an automated API testing session, two live `pending` payment rows were accidentally inserted into the production `payments` table because `.env.local` pointed at the production project. This guide documents how to prevent that from recurring.

## The guard

`createAdminClient()` (service-role, bypasses RLS) now refuses to initialise in `NODE_ENV=test` when the configured URL is a remote Supabase host. Attempting to call it without a local stack or bypass flag throws immediately with a clear message.

## Choosing a dev database

### Option A — Local Supabase stack (recommended)

Runs Postgres + Auth + Storage on your machine via Docker. Fully offline, zero risk to shared data.

**Prerequisites:** Docker Desktop running, Supabase CLI installed.

```bash
# Install CLI once
npm install -g supabase

# Start the local stack (first run pulls ~400 MB images)
supabase start

# Apply all migrations to the local DB
supabase db push

# Optional: seed dev data
# supabase db seed
```

Then add to `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key printed by supabase start>
SUPABASE_SERVICE_ROLE_KEY=<service role key printed by supabase start>
```

Stop the stack when done:

```bash
supabase stop
```

### Option B — Separate dev Supabase project

Create a second project on supabase.com named `furqan-dev` (or similar). Apply migrations:

```bash
supabase link --project-ref <dev-project-ref>
supabase db push
```

Update `.env.local` with the dev project's URL and keys. The prod project remains untouched.

### Option C — Keep pointing at prod (read-only tests only)

If you intentionally need to hit the remote project (e.g. the RLS regression suite in `rls.test.ts` uses the anon key for read-only assertions), set:

```env
SUPABASE_ALLOW_PROD_IN_TESTS=true
```

This bypasses the guard. **Only use this for tests that do not write any data.**

## CI configuration

The GitHub Actions `rls-tests.yml` workflow sets `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` from repo Secrets to run read-only RLS assertions against production. It does **not** set `SUPABASE_ALLOW_PROD_IN_TESTS` — and it doesn't need to because `rls.test.ts` uses `createClient` (anon, not service-role) and never calls `createAdminClient`.

If a future CI job needs `createAdminClient` against a real DB, add `SUPABASE_ALLOW_PROD_IN_TESTS: "true"` to that job's `env:` block and ensure the URL points at a dev project, not prod.

## Affected files

| File | Change |
|------|--------|
| `src/lib/supabase/admin.ts` | Guard added — throws on remote URL in `NODE_ENV=test` without bypass |
| `src/lib/supabase/admin.test.ts` | Bypass flag set in `beforeEach`; 5 new guard-specific tests |
