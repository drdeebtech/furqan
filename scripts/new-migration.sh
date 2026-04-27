#!/usr/bin/env bash
# Generate a new Supabase migration file with the correct filename convention
# and the right location for auto-deploy via the Branching GitHub integration.
#
# Usage:
#   ./scripts/new-migration.sh <descriptive_name>
#   ./scripts/new-migration.sh add_session_tags
#
# Output:
#   supabase/migrations/<UTC timestamp>_<descriptive_name>.sql

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <descriptive_name_in_snake_case>" >&2
  exit 1
fi

name="$1"
# Allow only lowercase letters, digits, underscores. Reject everything else.
if [[ ! "$name" =~ ^[a-z0-9_]+$ ]]; then
  echo "ERROR: name must be snake_case (lowercase letters, digits, underscores only)" >&2
  exit 1
fi

ts=$(date -u +%Y%m%d%H%M%S)
out="supabase/migrations/${ts}_${name}.sql"

mkdir -p supabase/migrations
cat > "$out" <<EOF
-- ${ts}_${name}.sql
-- Description: TODO — what does this migration change and why?

-- Your DDL/DML below. Prefer \`if not exists\` / \`on conflict do nothing\`
-- so re-runs are idempotent.

EOF

echo "Created: $out"
echo ""
echo "Next:"
echo "  1. Edit the file with your DDL"
echo "  2. (Optional) test locally: npx supabase db query --linked --file $out"
echo "  3. git add $out && git commit && git push origin main"
echo "     → auto-applies via the Supabase Branching integration"
