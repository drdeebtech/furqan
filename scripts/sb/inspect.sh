#!/usr/bin/env bash
# scripts/sb/inspect.sh — quick wrapper around `supabase inspect db <topic>`.
# Lists topics if no arg given; runs the inspector if topic provided.
#
# Topics (from `supabase inspect db --help`):
#   bloat, blocking, calls, db-stats, index-stats, locks,
#   long-running-queries, outliers, replication-slots, role-stats,
#   table-stats, traffic-profile, vacuum-stats
#
# Usage:
#   bash scripts/sb/inspect.sh                 # list topics
#   bash scripts/sb/inspect.sh table-stats     # row counts + sizes
#   bash scripts/sb/inspect.sh outliers        # slowest queries by total time
#   bash scripts/sb/inspect.sh long-running-queries

set -euo pipefail
source "$(dirname "$0")/_lib.sh"

TOPIC="${1:-}"

if [ -z "$TOPIC" ]; then
  echo "Available topics:"
  echo "  bloat                Wasted space from dead tuples"
  echo "  blocking             Locked queries + their blockers"
  echo "  calls                Most-called queries (pg_stat_statements)"
  echo "  db-stats             Cache hit rates, total sizes, WAL size"
  echo "  index-stats          Index size, usage %, scan counts"
  echo "  locks                Exclusive locks held now"
  echo "  long-running-queries Queries running > 5 minutes"
  echo "  outliers             Slowest queries by total exec time"
  echo "  replication-slots    Replication slot state"
  echo "  role-stats           Per-role connection + query stats"
  echo "  table-stats          Table size, index size, row counts"
  echo "  traffic-profile      Read vs write ratio per table"
  echo "  vacuum-stats         Per-table vacuum activity"
  echo ""
  echo "Bonus: bash scripts/sb/inspect.sh report   # CSV dump of all"
  exit 0
fi

if [ "$TOPIC" = "report" ]; then
  exec npx supabase inspect report --linked
fi

exec npx supabase inspect db "$TOPIC" --linked
