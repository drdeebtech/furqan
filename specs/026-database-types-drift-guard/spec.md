# Spec 026 — Drift management for `src/types/database.ts`

**Status:** Backlog — needs careful design (NOT a quick win)
**Created:** 2026-06-21
**Updated:** 2026-06-21 (premise corrected after a hands-on spike — see below)
**Owner:** unassigned
**Risk:** High (96 importers; this file is a hand-corrected layer, not a stale dup)

---

## ⚠️ Corrected premise (read first)

An initial version of this spec assumed `database.ts` was an *unguarded stale
duplicate* of `supabase.generated.ts` that could be guarded (Option A) or
collapsed via re-export (Option B). **A hands-on spike on 2026-06-21 disproved
that.** Both naive options are harmful. Do not attempt them as described.

`database.ts` is a **deliberately hand-corrected layer** over the generated
types. It embeds a copy of the `Database` type that has been patched to
compensate for Supabase codegen imprecision, then derives ~96-consumed domain
aliases (`SessionType`, `Profile`, `Booking`, …) from the corrected copy.

Proven corrections it carries (not exhaustive):
- **Function args with `DEFAULT NULL`** are typed non-null by the generator but
  patched to nullable here. E.g. `record_student_progress` args
  (`p_surah_from`, `p_ayah_from`, `p_pages_reviewed`, `p_quality_rating`,
  `p_level`, `p_teacher_notes`) are `… | null` in `database.ts` but plain
  `number`/`string` in `supabase.generated.ts`.
- **`Course`** overrides `teacher_id` to nullable and adds `ownership` /
  `teacher_revenue_share_bps`.
- **Ijazah / Mentorship** rows override `recitation_standard`, `status`,
  `requirement_type`, `severity` to hand-authored TEXT-CHECK unions.
- A block of TEXT-CHECK enum unions (`RecitationStandard`, `PackageType`, …)
  that the generator can't see (TEXT + CHECK, not `pg_enum`).

**Spike evidence:** collapsing `database.ts` to `import type { Database } from
"./supabase.generated"` (dropping the embedded corrected copy) compiled the
aliases against the raw generated types and immediately produced 12 `tsc`
errors in core code — 8 in `src/lib/domains/progress/capture.ts` (the
`record_student_progress` call correctly passes `null`) and 4 in
`src/lib/supabase/rpc.test.ts`. The errors are NOT bugs in that code; they are
the *loss of the nullability corrections*. Reverted.

## Residual real risk (narrower than first stated)

The embedded `Database` copy can still go stale on the parts that are **not**
deliberately corrected: add a column in Postgres and `Profile =
T["profiles"]["Row"]` won't see it until someone regenerates **and re-applies
the corrections**. There is no script and no CI guard for that workflow, so the
correctness depends on whoever edits the schema remembering to do it by hand.

So the goal is not "guard a stale dup" but "make the regenerate-then-re-patch
workflow reliable, without losing the hand corrections."

## Options (revised)

### Option A′ — Documented regen + re-patch workflow (lowest risk)

1. Add a top-of-file checklist comment in `database.ts` enumerating every
   correction (the list above), so a regen can re-apply them deterministically.
2. Add a `scripts/regen-database-types.md` (or a guarded `npm` script) that:
   regenerate body → re-apply the enumerated patches → `tsc`.
3. Optionally a CI *reminder* (not a hard diff) when migrations change but
   `database.ts` doesn't — a soft nudge, since a hard `diff` can't work (the
   corrections will always differ from raw codegen).

**Pros:** preserves corrections; makes the manual process explicit + repeatable.
**Cons:** still manual; relies on the checklist being kept current.

### Option B′ — Isolate corrections into an overlay (cleanest, hardest)

Refactor so the generated types are imported (single source of truth) and the
corrections live as an explicit, small overlay:
- Enum/row-level corrections express cleanly as `Omit<…> & { … }` overlays.
- **The hard part:** nested **function-arg** nullability (`Functions[fn]["Args"]`)
  does not `Omit`/patch cleanly. Needs a typed wrapper around `callRpc`, or a
  mapped-type overlay over `Database["public"]["Functions"]`. This is the design
  risk that makes B′ non-trivial.

**Pros:** eliminates the 6.6k-line embedded copy; corrections become auditable.
**Cons:** the function-arg overlay is genuinely tricky; needs a typed-RPC design
and a fresh-apply typecheck across all 96 importers.

## Recommendation

**Option A′** now (cheap, preserves correctness), and only attempt **B′** as a
deliberate, separately-reviewed design task with a typed-RPC layer — not a
mechanical edit. The earlier "Option A guard / Option B collapse" framing is
withdrawn: a hard CI diff is impossible (corrections always differ) and a
re-export collapse is proven to drop corrections.

## Acceptance criteria

- [ ] `database.ts` carries an explicit, current list of every hand-correction.
- [ ] A documented, repeatable regen + re-patch path (script or runbook).
- [ ] `npx tsc --noEmit` clean and `npm run test:unit` green after a dry-run regen.
- [ ] (B′ only) corrections isolated as overlays over `supabase.generated.ts`;
      a typed-RPC layer carries the function-arg nullability; embedded copy
      deleted; all 96 importers compile.

## Out of scope

- Any change to `supabase.generated.ts` or its existing `db-types-fresh.yml` guard.
- Schema migrations themselves.

## Three-lens check (AGENTS.md §1)

- 🛠 **Engineer:** the file is a correction layer, not a dup; the real risk is
  stale *uncorrected* rows after a schema change with no re-patch workflow.
- 📖 **Quran-integrity:** indirect — `record_student_progress` typing feeds the
  progress-capture path; a botched collapse (as the spike showed) lands first in
  `progress/capture.ts`, so this file must be handled with progress-integrity care.
- 🎓 **Teaching-platform:** protects every typed read (dashboards, booking) from
  compiling against stale column types.

## References

- Existing guard (for the OTHER file): `.github/workflows/db-types-fresh.yml`
- Generation script: `package.json` → `"db:types"` (writes `supabase.generated.ts`)
- Spike that corrected this spec: 2026-06-21, branch `chore/database-types-drift-guard`
  (collapse attempted, 12 tsc errors in `progress/capture.ts` + `rpc.test.ts`, reverted).
