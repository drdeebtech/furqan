# Spec 037 — Public teacher profile page + marketplace featured-tier grid

Follow-up to `036-teacher-marketplace`. Two features; **Feature 1 carries a
security-critical DB change and must be built in a session with the local
Supabase stack running.** Feature 2 is UI-only and ships independently.

Judged through the three lenses (CLAUDE.md §1): full-stack engineer, Quran
teacher, teaching-platform expert. Full RTL/Arabic first-class. WCAG-AA.

---

## Context

The merged marketplace (`(public)/teachers`) lists teachers but every card
dead-ends: a vetting parent gets a truncated bio + badges, then "Book" routes to
a generic contact form. There is **no public page for a single teacher**, and the
grid gives a 500-session Ijazah-holder the same visual weight as a brand-new
teacher (critique 25/40, two P1s). This spec closes both.

## Current state (verified 2026-07-05)

| Read path | Client | Scope | Public-safe? |
|---|---|---|---|
| `searchTeachers()` → RPC `search_public_teachers` (`teacher-search.ts:48`) | `createAdminClient` (service_role) | **list/search only**, projects safe columns | ✅ yes, but list-only |
| `student/teachers/[teacherId]/page.tsx:31` | `createClient` (authed, RLS) | single teacher, reads `profiles` directly | ❌ auth-gated — RLS blocks logged-out visitors |

RPC grants (`20260709000000_teacher_search_vector.sql:152-154`): EXECUTE
`REVOKE`d from `PUBLIC`, `anon`, `authenticated`; `GRANT`ed to `service_role`
only. This is the established safe pattern and the model to copy.

**The public data contract** (exact safe field set, from the `TeacherCard` the
RPC already returns): `id`, `full_name`, `full_name_ar`, `avatar_url`, `bio`,
`bio_en`, `languages[]`, `specialties[]`, `recitation_standards[]`, `hourly_rate`,
`rating_avg`, `rating_count`, `total_sessions`, `gender`. **Nothing else is
public** — no email, phone, exact schedule, internal IDs, or CV review state.

---

## Feature 1 — Public teacher profile page (`(public)/teachers/[teacherId]`)

### The security requirement (the whole point)

A logged-out visitor cannot use the authed read, and service_role must NOT query
`profiles` directly from a public route (that would expose whatever columns the
query selects). The **only** safe path is a new single-teacher `SECURITY DEFINER`
RPC that projects the exact contract above and nothing else.

### New migration (expand-only, backward-compatible)

```sql
-- get_public_teacher: single-teacher public projection. Mirrors
-- search_public_teachers' column set exactly. SECURITY DEFINER; returns only
-- verified-public teachers (same visibility predicate as the search RPC:
-- active, verified/approved, not a test account), NULL row otherwise.
CREATE OR REPLACE FUNCTION public.get_public_teacher(p_id uuid)
RETURNS TABLE ( /* the 14 contract columns above, byte-identical to search RPC */ )
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ ... $$;

REVOKE EXECUTE ON FUNCTION public.get_public_teacher(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_teacher(uuid) TO service_role;
```

- **Visibility predicate MUST match `search_public_teachers` exactly** — a teacher
  hidden from search must not be reachable by direct URL. Copy the predicate, do
  not re-derive it.
- Add `getPublicTeacher(id)` to `teacher-search.ts` (same `createAdminClient` +
  `callRpc` shape as `searchTeachers`), returning `TeacherCard | null`.

### Route

- `src/app/(public)/teachers/[teacherId]/page.tsx` — **Server Component**.
  `notFound()` (404) when the RPC returns null. Renders: avatar, bilingual name,
  **full** bio (bio/bio_en by lang), languages, specialties, recitation
  standards, gated ratings (stars only at `rating_count >= 3`, same rule as the
  card), credential badges, hourly rate (respect the `hidePrices` flag).
- **Booking CTA** routes through the EXISTING auth-gated flow (same target the
  card's "Book" uses today) — no new PII surface, just an entry point.
- **`Person` JSON-LD** via `src/components/seo/structured-data.tsx`, public fields
  only. Add per-profile `generateMetadata` (title/description/OG).
- Link marketplace card name + avatar to `/teachers/[id]` (`content.tsx`).

### Acceptance criteria (Feature 1)

1. Logged-out `GET /teachers/<valid-public-id>` returns 200 with the profile.
2. `GET /teachers/<hidden-or-nonexistent-id>` returns 404 (not a partial/empty page).
3. Response HTML contains **none** of: email, phone, schedule, CV state, non-public columns. (grep the rendered payload.)
4. `get_public_teacher` EXECUTE is denied to `anon` + `authenticated`, granted only to `service_role` (verified via `\df+` locally).
5. Its visibility predicate is identical to `search_public_teachers` (a teacher absent from search is 404 here).
6. Renders correctly in Arabic RTL and English LTR; ratings gated at ≥3 reviews; prices hidden when `hidePrices`.
7. `Person` JSON-LD validates; `generateMetadata` emits per-teacher title/description.
8. `npx tsc --noEmit`, `npm run lint`, `npm run build` green; `migration-safety` CI guard passes.

### Local-verification gate (MANDATORY before PR)

Bring up local Supabase (`supabase start` + `dev-local-db-bootstrap.sh`), apply
the migration, seed a public + a hidden teacher, and confirm: (a) public one
returns the 14 columns and nothing else, (b) hidden one returns null, (c) EXECUTE
grants are locked down. This is the "verify migrations locally" rule — do not skip.

---

## Feature 2 — Marketplace featured-tier grid (UI-only, no DB)

`src/app/(public)/teachers/content.tsx`. Give the top 1–3 teachers (by the RPC's
existing sort order — already ranks veterans above one-review newcomers) visual
primacy; condense the rest. Promote rating + total sessions to the prominent stat;
demote languages/availability. Keep the "New teacher" badge muted (not gold —
already fixed). Obey DESIGN.md Named Rules (One Metal, Gold-As-Text, Bilingual-
First, No-Kicker). Full RTL, WCAG-AA, reduced-motion fallback for any motion.

### Acceptance criteria (Feature 2)

1. Top teacher(s) visibly distinct from the rest (size/layout), not a uniform grid.
2. No gold spent on low-signal elements (One Metal / Gold-As-Text hold).
3. Correct in Arabic RTL and English LTR at 320/768/1024/1440; no overflow.
4. Featured treatment degrades cleanly when there are 0–2 teachers (no broken layout on thin supply).
5. `tsc` / `lint` / `build` green.

---

## Out of scope

- Teacher-editable profiles, reviews/testimonials submission, messaging.
- Any change to the search RPC's projection or ranking.
- Contact-form redesign (booking CTA reuses the existing target).

## Files reference

| File | Change | Feature |
|---|---|---|
| `supabase/migrations/<ts>_get_public_teacher.sql` | **new** SECURITY DEFINER RPC | 1 |
| `src/lib/supabase/teacher-search.ts` | add `getPublicTeacher(id)` | 1 |
| `src/app/(public)/teachers/[teacherId]/page.tsx` | **new** public route + JSON-LD + metadata | 1 |
| `src/app/(public)/teachers/content.tsx` | link cards to profile; featured-tier grid | 1 + 2 |
| `src/types/database.ts` | regen types after migration (`npm run db:types`) | 1 |

## Build order

1. **Feature 2 first** (no DB, ships now) — this session.
2. **Feature 1 in a fresh session** with local Supabase up: migration → local verify gate → `getPublicTeacher` → route → link cards → verify → PR.
