# P1 — Repo Health & Build

**Date:** 2026-05-15  
**Branch:** `main` @ `bb273c2`

---

## next build ✅

```
▲ Next.js 16.2.6 (Turbopack)
✓ Compiled successfully in 11.5s
✓ TypeScript — 8.7s (no errors)
✓ 134 routes generated (133 dynamic ƒ, 1 static ○)
Exit code: 0
```

No bundle-size table is emitted by Turbopack (unlike webpack mode). No build errors.

---

## tsc --noEmit ✅

```
Exit code: 0 (no output = clean)
```

TypeScript strict mode passes completely.

---

## Unit Tests (vitest run) ✅

```
Test Files  19 passed | 1 skipped (20)
     Tests  225 passed | 24 skipped (249)
  Duration  1.08s
```

One non-blocking warning: `Malformed folder (missing spec.md): 001-foo` — a leftover speckit scaffold entry with no spec file. Does not affect test execution.

---

## ESLint ⚠️ (exit 1 — 89 problems: 33 errors, 56 warnings)

### Root cause: ESLint scans `.claude/helpers/` (Claude Code runtime files)

The `.claude/helpers/*.cjs|.js` files are CommonJS Claude Code hook helpers that live inside the repo directory but are not application code. ESLint is not configured to ignore them. All `require()` errors originate there.

**Estimated false positives from `.claude/helpers/`: ~30 of the 33 errors, ~15 of the 56 warnings.**

### Real src/ errors (3 actual issues)

| File | Line | Rule | Severity | Issue |
|------|------|------|----------|-------|
| `src/app/teacher/progress/roster-heatmap.tsx` | 97 | `react-hooks/static-components` | Error | `SortIcon` component defined inside render function — creates new component type on every render, breaking state and performance |
| `src/components/admin/control-tower-grid.tsx` | 60 | `react-hooks/purity` | Error | `Date.now()` called inside `useRef()` initializer — flagged as impure; arguable false positive but technically produces different values across renders |
| `src/components/admin/remote-handoff-button.tsx` | 55 | `react-hooks/set-state-in-effect` | Error | `setState()` called synchronously inside `useEffect` body — can trigger cascading renders |

### Real src/ warnings (notable)

| File | Issue |
|------|-------|
| `src/app/teacher/students/[studentId]/page.tsx` | `HomeworkAssignment` imported but unused |
| `src/components/shared/nav.tsx` | `Video` icon imported but unused |
| `src/lib/daily/webhook-handler.test.ts` | 3 test helpers defined but unused |
| `src/components/admin/remote-handoff-button.tsx` | Stale `// eslint-disable-next-line react/no-danger` comment |

### Infrastructure fix needed (not a code fix)

Add `.claude/` to ESLint ignore list so CI lint reflects only application code:

```js
// eslint.config.mjs — add to ignores
".claude/**",
```

---

## Summary

| Check | Result | Notes |
|-------|--------|-------|
| `next build` | ✅ Pass | 134 routes, 11.5s compile |
| `tsc --noEmit` | ✅ Pass | Zero type errors |
| `vitest run` | ✅ Pass | 225/249 tests pass, 24 skipped |
| `eslint` | ⚠️ Exit 1 | 3 real src errors + `.claude/` false positives |

**Blocker:** No. Build and types are clean. Lint failure is partially a configuration gap (`.claude/` not ignored), partially 3 real component issues in teacher UI. None prevent deployment but the `SortIcon` defined-in-render issue will cause subtle state bugs.

---

*Read-only audit finding. Do not modify.*
