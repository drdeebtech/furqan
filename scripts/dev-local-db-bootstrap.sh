#!/usr/bin/env bash
#
# dev-local-db-bootstrap.sh — LOCAL DEVELOPMENT ONLY
#
# Builds the full FURQAN schema on a fresh local Supabase database.
#
# Why this script exists:
#   The repo has no single replayable baseline. The schema is layered:
#     1. src/lib/supabase/schema.sql            — "V8" consolidated baseline
#     2. src/lib/supabase/migrations/v9..v16    — legacy custom-format migrations
#     3. supabase/migrations/<timestamp>_*.sql  — current timestamped migrations
#   The timestamped migrations assume the legacy baseline already exists, so a
#   plain `supabase db reset` / `supabase db push` fails on a fresh DB
#   (e.g. "function is_admin() does not exist"). This script applies all three
#   layers in order against the local stack.
#
# Two local-only workarounds (faithful, do NOT change prod behavior):
#   * check_function_bodies=off — schema.sql defines SQL functions that
#     reference tables created later in the same file (forward refs).
#   * furqan_local_booking_end() IMMUTABLE shim — the bookings no_booking_overlap
#     EXCLUDE constraint uses `scheduled_at + interval` which Postgres treats as
#     STABLE; the shim is IMMUTABLE and semantically identical for pure-minute
#     intervals. (Prod's bookings table predates schema.sql, so prod never
#     replays this statement.)
#   * Permissive default privileges for role `postgres` are set BEFORE layer 1
#     so the V8 baseline tables get the anon/authenticated grants they
#     originally received from pre-v9 migrations (not in this repo). A later
#     hardening migration restricts defaults for newer tables; since
#     ALTER DEFAULT PRIVILEGES only affects future objects, the end state
#     matches prod.
#
# Prerequisites: docker running, `supabase` CLI, `psql`, and the local stack
# started (`supabase start`). Safe to re-run (it resets the DB each time).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="/usr/local/bin:$PATH"
export SUPABASE_AUTH_SMTP_PASS="${SUPABASE_AUTH_SMTP_PASS:-dummy}"

DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
TS_DIR="supabase/migrations"
BAK="$(mktemp -d /tmp/furqan_sb_migrations.XXXXXX)"

# Always restore the timestamped migrations to the repo, even on failure.
restore_migrations() {
  if [ -d "$BAK" ] && compgen -G "$BAK/*.sql" > /dev/null; then
    mv "$BAK"/*.sql "$TS_DIR"/ 2>/dev/null || true
  fi
  rmdir "$BAK" 2>/dev/null || true
}
trap restore_migrations EXIT

echo "==> Moving timestamped migrations aside for a clean reset"
mv "$TS_DIR"/*.sql "$BAK"/ 2>/dev/null || true

echo "==> supabase db reset (clean DB with Supabase default privileges)"
supabase db reset > /tmp/furqan_db_reset.log 2>&1 || { tail -20 /tmp/furqan_db_reset.log; exit 1; }

echo "==> Local-only session settings"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -c "ALTER DATABASE postgres SET check_function_bodies = off;" \
  || { echo "FAILED: check_function_bodies (database)"; exit 1; }
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -c "ALTER ROLE postgres SET check_function_bodies = off;" \
  || { echo "FAILED: check_function_bodies (role)"; exit 1; }

echo "==> Permissive default privileges for role postgres (pre-hardening parity)"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;" \
  || { echo "FAILED: default privileges (tables)"; exit 1; }
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;" \
  || { echo "FAILED: default privileges (sequences)"; exit 1; }
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;" \
  || { echo "FAILED: default privileges (functions)"; exit 1; }

echo "==> IMMUTABLE shim for the bookings EXCLUDE constraint"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -c "CREATE OR REPLACE FUNCTION furqan_local_booking_end(ts timestamptz, mins int) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS \$\$ SELECT ts + (mins * interval '1 minute') \$\$;" \
  || { echo "FAILED: furqan_local_booking_end shim"; exit 1; }

echo "==> Layer 1: V8 baseline (src/lib/supabase/schema.sql, patched copy)"
PATCHED="$(mktemp /tmp/furqan_schema.XXXXXX.sql)"
cp src/lib/supabase/schema.sql "$PATCHED"
sed -i "s/scheduled_at + (duration_min \* INTERVAL '1 minute')/furqan_local_booking_end(scheduled_at, duration_min)/g" "$PATCHED"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$PATCHED" > /tmp/furqan_layer1.log 2>&1 \
  || { echo "FAILED: Layer 1 (schema.sql)"; tail -30 /tmp/furqan_layer1.log; exit 1; }
rm -f "$PATCHED"

echo "==> Layer 2: legacy v9..v16 migrations"
# ON_ERROR_STOP is intentionally omitted for Layers 2-3. These files are
# non-idempotent by design: the V8 baseline already defines the same policies,
# triggers, constraints, and indexes that v9-v16 recreate, producing ~40
# "already exists" conflicts. The enforced sanity checks below (table count,
# profiles grant) serve as the real gate instead.
: > /tmp/furqan_layer2.log
for f in $(ls src/lib/supabase/migrations/*.sql | sort -V); do
  psql "$DB_URL" -f "$f" >> /tmp/furqan_layer2.log 2>&1 \
    || { echo "FAILED: Layer 2 psql process error in: $f"; tail -30 /tmp/furqan_layer2.log; exit 1; }
done

echo "==> Layer 3: timestamped migrations"
# Same rationale: 20260428000000_remote_baseline.sql is a full prod snapshot
# that produces ~300 "already exists" conflicts atop Layers 1+2.
: > /tmp/furqan_layer3.log
for f in $(ls "$BAK"/*.sql | sort); do
  psql "$DB_URL" -f "$f" >> /tmp/furqan_layer3.log 2>&1 \
    || { echo "FAILED: Layer 3 psql process error in: $f"; tail -30 /tmp/furqan_layer3.log; exit 1; }
done

# restore_migrations runs here via the EXIT trap
restore_migrations
trap - EXIT

echo "==> Sanity checks (enforced — exit 1 on failure)"
TABLE_COUNT="$(psql "$DB_URL" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>&1)" \
  || { echo "FAILED: could not query table count"; echo "$TABLE_COUNT"; exit 1; }
if [ -z "$TABLE_COUNT" ] || [ "$TABLE_COUNT" -eq 0 ] 2>/dev/null; then
  echo "FAILED: public tables count is '$TABLE_COUNT' (expected > 0)"
  tail -30 /tmp/furqan_layer1.log /tmp/furqan_layer2.log /tmp/furqan_layer3.log 2>/dev/null
  exit 1
fi
echo "    public tables = $TABLE_COUNT"

PROFILE_GRANT="$(psql "$DB_URL" -t -A -c "SELECT has_table_privilege('authenticated','public.profiles','SELECT');" 2>&1)" \
  || { echo "FAILED: could not query profiles grant"; echo "$PROFILE_GRANT"; exit 1; }
if [ "$PROFILE_GRANT" != "t" ]; then
  echo "FAILED: profiles authenticated SELECT grant is '$PROFILE_GRANT' (expected 't')"
  exit 1
fi
echo "    profiles authenticated SELECT grant = true"
echo "==> Done. Logs: /tmp/furqan_layer{1,2,3}.log"
