# Contract — `scripts/generate-specs-index.ts`

**Caller**: husky pre-commit hook (via lint-staged) AND n8n nightly cron (via SSH on Mac mini).
**Atomicity**: filesystem-level — write to `INDEX.md.tmp` then `fs.rename` (POSIX-atomic).
**Idempotent**: yes (FR-008) — running twice with no state change MUST produce zero diff.

---

## CLI invocation

```bash
npx tsx scripts/generate-specs-index.ts
```

No required arguments. Optional flags:

| Flag | Default | Purpose |
|---|---|---|
| `--dry-run` | false | Compute the would-be INDEX.md content; print to stdout; don't write the file. Exits 0 if clean, 1 if there's drift. |
| `--repo-root <path>` | `cwd` | Override the root of the repo. Used by tests with synthetic fixtures. |
| `--verbose` | false | Emit per-folder scan results to stderr. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success: INDEX.md was up-to-date OR was written; no warnings critical enough to fail. |
| 1 | Drift detected (in `--dry-run` mode only). Use this for CI gating: a PR that doesn't include INDEX.md changes when its specs/ changes alter the index would fail CI. |
| 2 | Hard error: failed to read filesystem, gh CLI returned a non-zero exit, or atomic rename failed. The pre-commit hook must NOT block the commit on this — print to stderr and exit 0 in the hook wrapper. |

## Stdout / stderr

- **Stdout**: one summary line at end:
  - `Wrote specs/INDEX.md (N active specs, M abandoned-recent)` if file changed.
  - `specs/INDEX.md unchanged` if no diff (idempotency check passed).
- **Stderr**: warnings (Malformed folders, gh API errors caught and downgraded to "PR state unknown"). One line per warning, prefixed with `[warn]`.

## Side effects

- Writes `specs/INDEX.md` (atomic rename). May overwrite existing file.
- Reads filesystem under `specs/` (no writes).
- Calls `gh pr list --head <branch> --state all --json state,url,number,closedAt,merged --limit 1` per branch, with results cached in-process per run.
- **No commits made** — the calling environment (pre-commit hook OR cron wrapper script) is responsible for staging + committing INDEX.md if it changed.

---

## Pre-commit hook contract

`.husky/pre-commit` (created by `npx husky init` and customised):

```bash
#!/usr/bin/env sh
npx lint-staged
```

`package.json` lint-staged config:

```json
{
  "lint-staged": {
    "specs/**/*.md": [
      "bash -c 'npm run specs:index && git add specs/INDEX.md'"
    ]
  }
}
```

The bash wrapper ensures the script + git-add run as a single chained command. lint-staged-driven invocation means the hook only runs when a `specs/**/*.md` file is in the staged set.

**Edge case — INDEX.md edited alone**: the lint-staged glob `specs/**/*.md` matches INDEX.md too. To avoid an infinite-loop possibility (regen produces same INDEX.md, no diff, no further trigger — actually safe), the script should detect "the only changed file is INDEX.md" and short-circuit. Implementation detail tracked in tasks.md.

---

## n8n cron wrapper contract

The cron job runs (via SSH on the Mac mini):

```bash
#!/usr/bin/env bash
set -e

cd /path/to/furqan
git fetch origin main
git checkout main
git pull --ff-only

if ! npx tsx scripts/generate-specs-index.ts; then
  echo "[index-bot] generate-specs-index.ts exited non-zero" >&2
  exit 1
fi

if ! git diff --quiet specs/INDEX.md; then
  git add specs/INDEX.md
  git commit -m "[index-bot] regenerate specs/INDEX.md (cron drift correction)"
  git push origin main
  echo "[index-bot] drift corrected"
else
  echo "[index-bot] INDEX.md current; no commit"
fi
```

n8n logs this to `automation_logs` per the existing pattern.

---

## Test plan (vitest)

- **Unit tests** (`scripts/__tests__/generate-specs-index.test.ts`):
  - Status precedence (PR-merged → Shipped beats tasks.md exists → Tasks-ready).
  - Branch name extraction from spec.md frontmatter.
  - Clarifications detection (presence of `## Clarifications` + `- Q:` bullet).
  - Malformed folder warning.
  - Abandoned-90-day cutoff.
  - Idempotency: 2× run with same state produces same output bytes.
  - Empty `specs/` produces "No specs yet" placeholder.
- **Integration**: real `gh` CLI against a real (or recorded) FURQAN repo state. Slower; gated to CI on push.
- **E2E**: pre-commit hook fires correctly when staging spec.md edits.

---

## Future versions / not in v1

- **`--watch` mode** — regenerate on filesystem change events. Useful for `/speckit.implement` sessions; defer.
- **JSON output mode** — emit `specs/INDEX.json` alongside `INDEX.md` for tooling that wants structured data. Defer until a tool needs it.
- **Markdown lint validation** — run `markdownlint` on INDEX.md as part of the build to catch format regressions. Defer; not v1.
