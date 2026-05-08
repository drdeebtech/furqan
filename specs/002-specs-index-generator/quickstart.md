# Quickstart — Specs Index Generator

How to run and test the generator locally before shipping. Phase 1 of `/speckit.plan`.

---

## Prereqs

1. Node 24.x installed (`.nvmrc` aligned).
2. `gh` CLI installed and authenticated against the FURQAN repo.
3. `tsx` available (`npx tsx --version` should resolve).
4. After the implementation lands: `npm install` to install husky + lint-staged from devDeps and trigger the `prepare` script.

---

## 1. Run the generator manually

```bash
npm run specs:index
```

Or directly:

```bash
npx tsx scripts/generate-specs-index.ts
```

Expected output:
- `specs/INDEX.md` written (or unchanged if already current).
- Stdout: `Wrote specs/INDEX.md (N active specs, M abandoned-recent)` or `specs/INDEX.md unchanged`.
- Stderr: any warnings about malformed folders.

Re-running with no state changes produces zero diff (FR-008 idempotency check).

---

## 2. Verify the pre-commit hook

1. Edit any `specs/<feature>/spec.md`.
2. `git add specs/<feature>/spec.md`.
3. `git commit -m "test: pre-commit hook"`.
4. Confirm:
   - The hook ran (you'll see lint-staged output).
   - `specs/INDEX.md` was added to the same commit if it changed.
   - The commit succeeded.
5. Run the test again with a non-spec file edit (e.g. `src/app/layout.tsx`):
   - The hook MUST NOT regenerate INDEX.md (lint-staged glob doesn't match).

---

## 3. Verify the cron-path drift correction

Simulate a hook bypass:

```bash
# Edit a spec, commit while bypassing the hook
git commit -m "deliberate hook bypass" --no-verify

# Run the cron-equivalent command
git pull --rebase
npx tsx scripts/generate-specs-index.ts
git diff --quiet specs/INDEX.md || git add specs/INDEX.md && git commit -m "[index-bot] regenerate specs/INDEX.md (cron drift correction)"
```

Confirm:
- The drift was detected and a `[index-bot]` commit was made.
- `git log --grep='\[index-bot\]'` returns the commit.

---

## 4. Verify idempotency

```bash
# First run
npx tsx scripts/generate-specs-index.ts
git diff specs/INDEX.md  # may show changes

# Stage and commit, then re-run immediately
git add specs/INDEX.md && git commit -m "regen INDEX.md"
npx tsx scripts/generate-specs-index.ts
git diff specs/INDEX.md  # MUST show zero changes
```

If the second run produces a diff, idempotency is broken — investigate sort order, line endings, or PR-state cache.

---

## 5. Run the test suite

```bash
npx vitest run scripts/__tests__/generate-specs-index.test.ts
```

Expected: all green. Tests cover:
- Empty `specs/` directory produces "No specs yet" placeholder.
- Spec folder with only spec.md → status Draft.
- Spec folder with spec.md + `## Clarifications` Q→A → status Clarified.
- Spec folder with plan.md → status Planned.
- Spec folder with tasks.md → status Tasks-ready (without PR).
- gh PR open → status Implementing.
- gh PR merged → status Shipped.
- gh PR closed-not-merged within 90 days → row in Abandoned section.
- gh PR closed-not-merged > 90 days → row suppressed.
- Spec folder without spec.md → status Malformed + warning.
- Idempotency: 2× run without state change → zero diff.

---

## 6. Sanity-check at scale

The script runs against the repo's spec count, not user count. The implementation should be sized for ≤50 spec folders (well above the realistic ceiling of ~30 in-flight at any time):

```bash
# Synthetic scale test (run from a scratch dir, not the real repo)
mkdir -p /tmp/specs-scale-test/specs
for i in $(seq 1 50); do
  printf -v num "%03d" "$i"
  mkdir -p "/tmp/specs-scale-test/specs/$num-test-feature"
  echo "**Feature Branch**: \`$num-test-feature\`" > "/tmp/specs-scale-test/specs/$num-test-feature/spec.md"
done
cd /tmp/specs-scale-test
time npx tsx /Users/drdeeb/furqan/scripts/generate-specs-index.ts
# Expected: <5 seconds wall-clock at 50 specs
```

If the wall-clock exceeds 10 seconds at 50 specs, escalate to research.md §"gh CLI for PR-state lookup" — likely the per-branch API call cost, fixable by switching to the single-call `gh pr list --json` strategy mentioned in alternatives.
