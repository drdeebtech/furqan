# Research — Specs Index Generator

Phase 0 of `/speckit.plan`. Resolves the open technical questions for Phase 1 design.

---

## husky 9 setup pattern

**Decision**: Adopt husky 9 with the `prepare` script trick. Run `npx husky init` once to generate `.husky/pre-commit`, then customise it. Add `"prepare": "husky"` to `package.json` so contributors get the hooks automatically on `npm install`.

**Rationale**: husky 9 is a substantial simplification over husky 4–8 (no `_/` runner directory, no `.husky/_` shim). The `prepare` script is npm-native — no separate "post-install" tooling needed. Contributors who clone fresh and `npm install` get the hook on first install; no doc burden beyond a one-line README addition.

**Alternatives considered**:
- **simple-git-hooks** — lighter than husky but doesn't support per-glob staged-file filtering. Would require pairing with `lint-staged` anyway, so no advantage.
- **Native git hooks symlinked from a tracked file** — fragile on fresh clones because git won't auto-symlink; would require a custom `prepare` script to re-symlink. More moving parts than husky.
- **Pre-commit framework (Python)** — no thanks, FURQAN is a Node project; adding Python tooling to the dev path adds friction.

---

## lint-staged config for path-glob hook gating

**Decision**: Use `lint-staged` to scope the regen to commits that actually touch `specs/**/*.md`. Config in `package.json`:

```json
{
  "lint-staged": {
    "specs/**/*.md": "npm run specs:index && git add specs/INDEX.md"
  }
}
```

The `.husky/pre-commit` calls `npx lint-staged`. lint-staged inspects the staged file list, finds matches, runs the configured command, and re-stages any output changes.

**Rationale**: Without lint-staged, every commit (regardless of whether it touches specs) would run the regen. At dev-time scale, contributors commit dozens of times per day; running an unnecessary regen on each adds wall-clock latency. Path-glob gating runs the script ~5–20 times/day instead of ~50–200.

**Alternatives considered**:
- **Run regen unconditionally** — simpler config, but slower for non-specs commits.
- **Bash-grep the staged files in `.husky/pre-commit`** — works but reinvents lint-staged poorly.

---

## Filesystem-atomic-write pattern

**Decision**: Write `INDEX.md.tmp` first, then `fs.rename(INDEX.md.tmp, INDEX.md)`. POSIX rename is atomic on the same filesystem.

**Rationale**: If the script is interrupted mid-write (Ctrl-C, crash, OOM), the partial content lands in `.tmp` not `INDEX.md`. Worst-case is a stale `.tmp` to clean up; INDEX.md never reaches a half-written state. Aligns with Constitution Principle III's "atomic critical paths" (tooling-scale variant).

**Alternatives considered**:
- **Direct write to INDEX.md** — non-atomic on crash; unacceptable for a file that's meant to be authoritative.
- **Use a markdown formatter library** — overkill; the format is a fixed table. We hand-format and use the rename trick.

---

## gh CLI for PR-state lookup

**Decision**: Use `gh pr list --head <branch> --state all --json state,url,number,closedAt,merged --limit 1` per branch. Cache results in a `Map<branch, PRState>` for the duration of one regen run.

**Rationale**: `gh` is already in the FURQAN dev/cron path (used by other workflows). The `--state all` query returns the most recent PR by default, which is what we want. `--limit 1` saves API quota — there can only be one "most recent" state per branch.

At 50k user scale: ≤30 concurrent specs × 1 cached call each = ≤30 API calls per regen. Run time dominated by the calls (~5s wall-clock for 30 calls). Caching ensures no per-row repeated lookups.

**Alternatives considered**:
- **GitHub REST API directly via `fetch`** — works but requires token plumbing (vs. gh's existing auth context).
- **Use `git log` to find merge commits referencing the branch** — works for `Shipped` but can't distinguish `Implementing` (open PR) from `Abandoned` (closed-not-merged). gh is the source of truth.
- **Scan `gh pr list --json` once for all branches and filter in JS** — single API call instead of N. Worth promoting to a v2 optimisation if N grows past ~100. For now, per-branch with caching is the simpler implementation.

---

## Idempotency: zero-diff-on-no-state-change

**Decision**: Sort INDEX.md rows by NNN-prefix ascending (Active section); sort Abandoned section by `closedAt` descending (most-recently-abandoned first). Use UNIX line endings (`\n`). End file with a single newline. Use a fixed-width column format (Markdown tables auto-align, but we trim trailing whitespace).

**Rationale**: FR-008 requires that running the generator twice without state change produces no diff. Sources of accidental diff: (a) row ordering nondeterminism (`fs.readdir` doesn't guarantee order), (b) inconsistent line endings, (c) trailing whitespace, (d) PR-state cache misses producing different results. (a)-(c) are fixed by deterministic sort + format normalisation; (d) is fixed by within-run caching.

**Alternatives considered**:
- **Hash-compare before write** — compute hash of new content, only write if different from existing INDEX.md. Cleaner than rename trick. Adopt as a follow-up optimisation; for v1, the rename pattern is enough.

---

## n8n cron commit shape

**Decision**: The n8n nightly workflow at 03:00 UTC SSHes to the Mac mini, runs `git pull && npx tsx scripts/generate-specs-index.ts && git diff --quiet specs/INDEX.md || (git add specs/INDEX.md && git commit -m '[index-bot] regenerate specs/INDEX.md (cron drift correction)' && git push)`. Commit author is the existing `drdeebtech@gmail.com` (per FR-005 + Q3 clarification); the `[index-bot]` subject prefix makes drift-correction commits filterable in `git log`.

**Rationale**: SSH-and-run is the existing n8n pattern for Mac mini ops. Direct push to main (no PR) is justified because: (a) the diff is mechanical and bounded (only INDEX.md changes), (b) the script is idempotent so a bad run produces zero diff (no broken commit), (c) PR-gating drift-correction would create a daily backlog of trivial PRs. Per Branch Hygiene Rule's "no v2 / no zombie branches" — bot commits to main directly.

**Alternatives considered**:
- **n8n calls a GitHub workflow_dispatch** — adds latency, requires GH Actions credentials. n8n SSH path matches existing FURQAN conventions.
- **Skip the cron, rely only on pre-commit** — accepts staleness when contributors merge via GitHub UI without running the hook locally. The cron is the safety net.
- **Open a PR for drift correction instead of pushing direct** — adds a minute of operator review per day for zero-decision changes. Not a good ROI.

---

## Open questions deferred to /speckit.tasks or later

- **First-run population of INDEX.md** — should the implementation PR also commit the first generated INDEX.md, or wait for the cron's first run? Defer to the implement step; either way is fine.
- **What about `specs/INDEX.md` itself in the lint-staged glob?** The hook regenerates INDEX.md when other specs change; it should NOT trigger on INDEX.md edits to avoid an infinite loop. lint-staged's glob `specs/**/*.md` catches INDEX.md too — fix this in the tasks layer by excluding INDEX.md or by detecting "INDEX.md is the only changed file" and short-circuiting.
- **Cron secret rotation** — the cron uses SSH, not the `CRON_SECRET` HTTP token. SSH key rotation is an n8n-side concern, not this PR's.
