# Cursor Cloud environment — setup & gotchas

> Extracted from `AGENTS.md` on 2026-07-12 to keep the agent contract lean.
> Read this when running in the Cursor Cloud VM (dev mode against a local
> Supabase stack in Docker). The update script only runs `npm install`;
> everything below is started/applied manually per session.

## Toolchain

- **Node 24** is required (`package.json` `engines`). The VM's daemon node is v22
  and sits first in a fresh shell's `PATH`; the agent's `~/.bashrc` prepends the
  nvm Node 24 bin so interactive shells get the right version. If `node -v` shows
  v22, run `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`.
- Docker, the `supabase` CLI, and `psql` are installed in the VM image (not via
  npm). Docker has no systemd here — start the daemon manually if it is not
  running: `sudo bash -c 'nohup dockerd >/var/log/dockerd.log 2>&1 &'` then
  `sudo chown "$USER" /var/run/docker.sock` (daemon uses the `fuse-overlayfs`
  storage driver with the containerd snapshotter disabled — see
  `/etc/docker/daemon.json`).

## Start the backend + DB (per session)

1. `export SUPABASE_AUTH_SMTP_PASS=dummy` (config.toml interpolates this; the
   value is unused locally — local mail goes to Mailpit at `http://127.0.0.1:54324`).
2. `supabase start` — boots Postgres/Auth/Storage. Studio: `http://127.0.0.1:54323`.
3. `bash scripts/dev-local-db-bootstrap.sh` — builds the **full schema**. This is
   required: the repo has **no single replayable baseline**, so plain
   `supabase db reset` / `supabase db push` fails on a fresh DB with
   `function is_admin() does not exist`. The script layers
   `src/lib/supabase/schema.sql` (V8 baseline) → `src/lib/supabase/migrations/v9..v16`
   (legacy) → `supabase/migrations/*` (timestamped). It is safe to re-run (it
   resets the DB). See the script header for the local-only workarounds it applies.

## Env + run the app

- `.env.local` points at the local stack (URL `http://127.0.0.1:54321`, plus the
  static local anon/service_role JWT keys, which are the same on every local
  Supabase install). It is gitignored; recreate it from `supabase status` if missing.
- `npm run dev` → `http://localhost:3000` (Turbopack).

## Standard commands (see `package.json` / `README.md`)

- Lint: `npm run lint` · Unit tests: `npm run test:unit` (Vitest, ~510 pass).
- E2E (`npm test`, Playwright) needs browsers first: `npx playwright install`
  (skipped at install time via `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).

## Gotchas / known non-issues

- **BotID & auth rate limiting are skipped** unless `process.env.VERCEL` is set,
  so local register/login works without bot tokens. Email confirmation is off
  (`config.toml`), so new accounts can log in immediately.
- **New students are intentionally redirected** from `/student/dashboard` to the
  onboarding teacher-selection page (`/student/teachers?new=1`) until they pick a
  teacher. This is by design, not a bug.
- The DB starts with **no seeded teachers/content**, so browse/list pages show
  empty states. Tables like `blog_posts` / `contact_submissions` are not created
  locally (they came from pre-v9 originals absent from the repo); the blog/contact
  marketing pages are not exercisable locally but core flows are unaffected.
- A pre-existing client-side React warning ("Rendered more hooks than during the
  previous render") can appear on some `/student/*` pages; pages still render and
  return 200. This is app code, unrelated to environment setup.
- First request to a route compiles on demand (dev mode) and can take several
  seconds; this can briefly show a browser "page couldn't load" before it loads.
