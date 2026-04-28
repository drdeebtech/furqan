#!/usr/bin/env bash
# scripts/sb/backup.sh — snapshot prod DB schema or data to a local file.
# Wraps `supabase db dump --linked` with sane defaults + dated filename.
#
# Usage:
#   bash scripts/sb/backup.sh           # schema-only (.sql)
#   bash scripts/sb/backup.sh data      # data-only (.sql)
#   bash scripts/sb/backup.sh full      # schema + data
#
# Output goes to ./backups/ (gitignored).

set -euo pipefail
source "$(dirname "$0")/_lib.sh"

KIND="${1:-schema}"
TS="$(date -u +%Y%m%d-%H%M%S)"
DEST_DIR="${REPO_ROOT}/backups"
mkdir -p "$DEST_DIR"

case "$KIND" in
  schema)
    DEST="${DEST_DIR}/${TS}-schema.sql"
    info "Dumping schema → $DEST"
    npx supabase db dump --linked --schema public > "$DEST"
    ;;
  data)
    DEST="${DEST_DIR}/${TS}-data.sql"
    info "Dumping data → $DEST"
    npx supabase db dump --linked --data-only > "$DEST"
    ;;
  full)
    SCHEMA_DEST="${DEST_DIR}/${TS}-schema.sql"
    DATA_DEST="${DEST_DIR}/${TS}-data.sql"
    info "Dumping schema → $SCHEMA_DEST"
    npx supabase db dump --linked --schema public > "$SCHEMA_DEST"
    info "Dumping data → $DATA_DEST"
    npx supabase db dump --linked --data-only > "$DATA_DEST"
    DEST="$SCHEMA_DEST + $DATA_DEST"
    ;;
  *) die "Unknown kind: $KIND (use schema|data|full)" ;;
esac

ok "Done: $DEST"
