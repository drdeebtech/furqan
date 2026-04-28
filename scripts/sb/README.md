# `scripts/sb/` — Supabase admin toolkit

Wrappers around the Supabase CLI + Management API, tuned for the everyday
"I need to do an admin thing right now from terminal" use cases that come
up debugging furqan in production.

> All scripts run against the **linked production project**
> (`project_id` in `supabase/config.toml`). There is no staging here.
> Read each script's header before running anything destructive.

## Setup (one-time)

Create a Supabase Personal Access Token (PAT) at
https://supabase.com/dashboard/account/tokens and add it to `.env.local`:

```
SUPABASE_ACCESS_TOKEN="sbp_..."
```

This is what direct Management API calls use (separate from the CLI's
keychain-stored auth, which is also fine but isn't accessible to scripts).

`.env.local` is gitignored, so the token stays local.

## Quick reference

| Script | What it does | npm shortcut |
|---|---|---|
| `whoami.sh` | Sanity check: who, what's linked, recent activity | `npm run sb:whoami` |
| `sql.sh "..."` | Run arbitrary SQL via Management API | `npm run sb:sql -- "<sql>"` |
| `find-user.sh <email>` | Find user across auth.users + public.profiles | `npm run sb:user -- <email>` |
| `reset-password.sh <email>` | Trigger recovery email | `npm run sb:reset-pw -- <email>` |
| `auth-errors.sh [hours]` | Recent auth log errors (default last 1h) | `npm run sb:errors [-- <hours>]` |
| `inspect.sh [topic]` | Wraps `supabase inspect db <topic>` (see below) | `npm run sb:inspect [-- <topic>]` |
| `advisors.sh [kind]` | Security + performance advisors | `npm run sb:advisors` |
| `grants.sh [broken-only]` | EXECUTE grants on SECURITY DEFINER funcs | `npm run sb:grants` |
| `tables.sh` | Row counts + size + RLS status per table | `npm run sb:tables` |
| `backup.sh [schema\|data\|full]` | Dump to `backups/<ts>-*.sql` | `npm run sb:backup` |

## `inspect.sh` topics

Pulled directly from `supabase inspect db --help`:

| Topic | Use case |
|---|---|
| `bloat` | Wasted disk from dead tuples |
| `blocking` | Locked queries + their blockers |
| `calls` | Most-called queries |
| `db-stats` | Cache hit rates, total size, WAL size |
| `index-stats` | Index size + usage % + unused indexes |
| `locks` | Exclusive locks held right now |
| `long-running-queries` | Queries > 5 min |
| `outliers` | Slowest by total exec time |
| `replication-slots` | Replication slot state |
| `role-stats` | Per-role connection stats |
| `table-stats` | Table size + row counts |
| `traffic-profile` | Read vs write ratio |
| `vacuum-stats` | Per-table vacuum activity |
| `report` | CSV dump of all topics |

## Common workflows

### "User says they didn't get a recovery email"

```bash
npm run sb:user -- user@example.com    # confirm they exist
npm run sb:reset-pw -- user@example.com # trigger recovery
sleep 5
npm run sb:errors -- 0.1               # last 6 minutes — was there an SMTP error?
```

### "RLS policy threw permission denied for function X"

```bash
npm run sb:grants -- broken-only       # find revoked SECURITY DEFINER funcs
# Fix in scripts/sb/sql.sh:
npm run sb:sql -- "grant execute on function public.X() to authenticated"
```

### "App feels slow"

```bash
npm run sb:inspect -- outliers         # what queries take the most total time?
npm run sb:inspect -- long-running-queries
npm run sb:inspect -- index-stats      # missing or unused indexes?
npm run sb:inspect -- bloat            # vacuum needed?
```

### "Pre-deploy safety net"

```bash
npm run sb:backup                      # schema snapshot to backups/
npm run sb:advisors                    # any new security/perf issues?
```

### "Audit the database state"

```bash
npm run sb:tables                      # what's there + RLS coverage
npm run sb:grants                      # function permission map
npm run sb:inspect -- report > inspect-report.csv
```

## Notes

- **`sb_sql` runs via the Management API**, which uses your PAT and runs as
  the postgres role. RLS does **not** apply. Treat this like having a root
  shell on the database.
- **`reset-password.sh` uses the public anon API**, not the management API,
  because that's the same endpoint Studio's "Send recovery" button hits.
  Email delivery depends on SMTP being configured (see CLAUDE.md / config.toml).
- **`backup.sh` writes to `./backups/`** — make sure that's gitignored.
- **No script edits prod schema directly.** They read or trigger user-facing
  flows. For schema changes, use `scripts/new-migration.sh` + git push.

## Adding a new admin script

1. Copy one of the existing files as a template.
2. `source "$(dirname "$0")/_lib.sh"` at the top.
3. Use `sb_sql` for SQL, `sb_mgmt_api` for other Management API endpoints.
4. Add a corresponding `package.json` script.
5. Add a row to the table above.
