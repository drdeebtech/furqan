# Spec 042 — Daily.co cloud recording (opt-in, RLS-gated)

**Issue:** #564
**Type:** Feature — DB table + RLS + Daily.co webhook extension + consent flow + two read pages.
**Status:** Architect draft — **BLOCKED on two owner/legal decisions (§2). Do not build until resolved.**

---

## 1. Problem & goal

Students who miss a correction, want to review, or are in a different time zone have no way to
replay a session. Daily.co supports cloud recording natively but is unused. Goal: **opt-in**
recording, URL stored via webhook, access strictly limited by RLS to that session's student +
teacher, surfaced at `/student/recordings` and `/teacher/recordings`.

## 2. ⛔ Owner/legal gates — resolve BEFORE any build

- **G-1 (licensing / 📖 Quran integrity):** recording sessions where Quran is recited needs a
  **licensing/fiqh review** (the issue and PEDAGOGY_ROADMAP.md §11 both flag this — same class as
  Talqeen realtime). This is a **product/legal decision, not an engineering one.** Not my call.
- **G-2 (privacy / minors):** students may be minors. Explicit, non-default consent from **both**
  teacher and student/guardian, plus a **retention policy** (how long recordings live, deletion
  path, guardian consent for under-18s) are owner/legal decisions. Recording minors without a
  defined consent+retention policy is a hard stop.

The spec below is technically complete and builder-ready **conditional on G-1 and G-2 being
answered.** Ship nothing until they are.

## 3. The three lenses

- **📖 Quran teacher:** no scripture stored/generated (recording is audio/video of a live session,
  not Quran text) — but the *licensing* of recording recitation is the G-1 gate.
- **🛠 Engineer:** new `session_recordings` table with RLS in the **same migration** (expand/contract
  safe). Extend the **existing** verified Daily webhook (`src/app/api/webhooks/daily/route.ts`) for
  `recording.ready` — reuse its signature verification; fail-closed. `recording_url` never exposed
  to anyone but the session's two parties. Consent gates recording activation at booking.
- **🎓 Teaching-platform:** explicit opt-in UI at booking (default OFF), clear consent copy, RTL,
  two simple list pages. Accessibility on the player/links.

## 4. Design

**Data — new migration `session_recordings`:**
- Columns: `id`, `session_id` (FK → sessions), `recording_url` (text), `duration_seconds` (int),
  `created_at` (timestamptz default now()).
- **RLS (in the same migration):** SELECT allowed only when `auth.uid()` is the session's `student_id`
  or `teacher_id` (join via sessions/bookings). No INSERT/UPDATE/DELETE for `authenticated` —
  **writes only via the service-role webhook.** No anon access.
- Consent: a boolean opt-in captured at booking time (both parties). Store on the booking/session
  (confirm exact column with a small follow-up migration or reuse if one exists). Recording is only
  started for sessions where **both** consented.

**Webhook — extend `src/app/api/webhooks/daily/route.ts`:**
- Handle `recording.ready` — verify signature (reuse existing verification, fail-closed 400),
  idempotent insert (there's already `webhooks/daily/idempotency.test.ts` — mirror it), map the
  Daily payload's recording URL + duration + session to a `session_recordings` row.
- Re-fetch/guard: Daily payloads may omit expandables — use payload-guaranteed fields or re-fetch
  (same lesson as the Stripe webhook).

**Recording activation:**
- Only enable Daily cloud recording for a room when both consented. Where rooms are created/joined
  (`halaqa-room.tsx` / session room creation) — gate the recording flag on consent.

**Read pages:** `/student/recordings`, `/teacher/recordings` — list the caller's session recordings
(RLS does the scoping; the query trusts RLS, never a client-supplied userId). RTL, simple list +
player/link.

## 5. Security checklist (hard requirements)

- [ ] RLS on `session_recordings` shipped in the same migration; SELECT scoped to the session's
      student + teacher only; no anon; writes service-role only.
- [ ] `userId` never from request input — always the authenticated session.
- [ ] Daily webhook signature verified, fail-closed; idempotent insert (no dup rows on retry).
- [ ] `recording_url` never returned to a non-party; not logged.
- [ ] Consent explicit + default-OFF; recording never starts without both parties' opt-in.

## 6. Acceptance criteria

- [ ] Teacher + student opt-in to recording at booking (explicit, default OFF).
- [ ] Recording URL stored after Daily `recording.ready` webhook (verified, idempotent).
- [ ] RLS: only the session's student + teacher can read the recording URL (proven on a real DB —
      negative control: a third user sees zero rows).
- [ ] `/student/recordings` + `/teacher/recordings` list only the caller's recordings; RTL correct
      (browser screenshot, not assumed).
- [ ] G-1 (licensing) and G-2 (consent + retention policy) resolved and reflected in the consent copy
      + retention behavior.

## 7. Tasks (build order — only after G-1/G-2)

1. Migration: `session_recordings` + RLS (same file). DB-prove RLS with a rolled-back walk
   (party sees row / non-party sees none / anon sees none).
2. Consent field at booking + activation gate on room creation (default OFF).
3. Extend Daily webhook for `recording.ready` — verified, idempotent insert; unit test mirrors
   `idempotency.test.ts`.
4. `/student/recordings` + `/teacher/recordings` read pages (RLS-trusting queries), RTL.
5. RTL browser screenshot + vision check both pages; retention behavior per G-2.

## 8. Non-goals

- No in-app video editing/hosting (Daily hosts; we store URLs). No recording without consent. No
  admin-wide recording access (only the two session parties). No build until G-1/G-2 are resolved.
