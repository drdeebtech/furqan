# Spec 032 — Real-time Notifications (+ unblocks #540 juz modal)

Closes #526. Adds a live in-page realtime channel so the notification bell/list
update instantly and the deferred juz-completion celebration modal (#540) can fire.

Build sheet. **Claude planned it; Codex implements.**

---

## Headline decision (advisor — READ FIRST)

The issue claims "the Pusher client is already in the stack — wiring only." **False.**
`package.json` has no `pusher`/`pusher-js`; only `web-push` (#538, a different, offline
mechanism). `src/lib/csp.ts` has one pre-staged `wss://ws-us3.pusher.com` line and
nothing else.

So Pusher = **new vendor + new secret + monthly cost + a new auth endpoint to secure**.

**Recommended path: Supabase Realtime** (already in `@supabase/supabase-js`):
subscribe the client to `INSERT`s on the existing `notifications` table filtered to
the user — **RLS *is* the channel auth** (no auth endpoint to write/secure),
`wss://*.supabase.co` is **already** in CSP, and there's no second vendor to pay or
rotate keys for. Satisfies every acceptance criterion of #526 **and** #540.

**The integration seam below is transport-agnostic** — only the transport file
differs between Supabase Realtime (recommended) and Pusher (literal ask). Decide the
transport, then build the identical seam.

---

## Three-lens check
- 🛠 Engineer: security boundary = channel ownership (id from `getUser()`/RLS, never request body, fail-closed). Secret server-only (Pusher path). Both trigger and client **fail-soft to the existing pull-based UX** when unconfigured or the socket drops. CSP stays tight. Poke-not-payload → socket never trusted as a data source.
- 📖 Quran teacher: only surface is the juz modal rendering a juz *number* from the server-computed value (correct Arabic numerals, no ayah text generated client-side).
- 🎓 Platform: live badge + instant arrival is real motivational UX; the juz modal is the highest-emotion moment in hifz. RTL toast/modal, respect `prefers-reduced-motion`, toast only high-priority types to avoid fatigue.

## The key seam (identical for either transport)
Make `notify()` (`src/lib/notifications/dispatcher.ts`) the single trigger point.
Inside the existing `if (inAppEnabled)` block, after the insert, add one fire in
`after()` so it never blocks and is fail-soft:
```ts
after(() => triggerUserEvent(opts.userId, "notification.created", { id: insertedId })
  .catch((e) => logError("realtime trigger failed", e, { tag: "realtime" })));
```
This makes the bell **and** list live for **all** notification types — no per-caller
changes. **Payload = a poke, not the data:** client reacts by calling the existing
RLS-guarded `fetchNotifications()` server action (sidesteps ordering/dedupe; <1s).
Optimistic prepend is an optional later refinement.

## Decisions (settled, pending transport choice)
1. **Transport:** Supabase Realtime (recommended) **vs** Pusher. ← the one open decision.
2. **Trigger point:** `notify()`, once (root-cause wiring).
3. **Poke, not payload.** Never trust the socket as a data source.
4. **#540 modal:** beside the existing `emitEvent("progress.juz_completed", …)` in `src/lib/domains/progress/juz-completion.ts`, also fire a realtime event for the student; a `JuzCelebration` client component renders a full-screen Arabic modal with the server-computed juz number. De-dupe per juz in `sessionStorage` so a reconnect/replay can't re-fire.
5. **Fail-soft:** client provider + trigger both no-op when unconfigured → existing mount/refetch UX stays; no crash on socket drop.

### Supabase Realtime specifics (recommended)
- Client subscribes to `postgres_changes` INSERT on `notifications` filtered `user_id=eq.{id}`; RLS enforces ownership. No auth endpoint. No CSP change (`*.supabase.co` already allowed). For the juz modal, either subscribe to a dedicated channel or reuse the notification insert (juz already calls `notify()`), reading the new row.

### Pusher specifics (only if chosen over Supabase)
- Deps `pusher` + `pusher-js`. Private channel `private-user-{id}`. `POST /api/pusher/auth`: id from `getUser()`, parse channel, 403 if `{id}≠user.id` or no session, else `authorizeChannel`. Env: `PUSHER_APP_ID/SECRET/KEY/CLUSTER` (server-only) + `NEXT_PUBLIC_PUSHER_KEY/CLUSTER`. CSP: add `https://sockjs-us3.pusher.com` (keep cluster `us3` to match the pre-staged `ws-us3`).

## Files
Add: `src/lib/realtime/<transport>.ts` (`triggerUserEvent`, no-op+log if unconfigured); `src/components/realtime/realtime-provider.tsx` (`"use client"`, takes `userId` prop, no-op if unconfigured); `src/components/student/juz-celebration.tsx` (full-screen RTL modal); (Pusher only) `src/app/api/pusher/auth/route.ts`.
Change: `src/lib/notifications/dispatcher.ts` (the one `after()` trigger); `src/lib/domains/progress/juz-completion.ts` (realtime juz event); `src/lib/csp.ts` (Pusher path only); `src/components/shared/notification-bell.tsx` + `src/app/student/notifications/notifications-list.tsx` (bind → reload, cleanup on unmount); the authenticated student layout (mount provider + `<JuzCelebration/>`); `.env.example`/`package.json` (Pusher path only).

## Risks + test plan
- **CSP silently blocks the socket** (#1 failure mode for Pusher) — verify in a real browser console post-deploy. (Supabase path avoids it.)
- **New vendor + cost** (Pusher) — self-inflicted; Supabase Realtime is already paid for.
- **Socket down / outage** — existing mount/refetch keeps the bell working; criterion "graceful degradation" met by keeping the pull path.
- **Replay/dup on reconnect** — poke→refetch is idempotent for the list; modal needs per-juz `sessionStorage` de-dupe.
- Tests (Vitest): (Pusher) auth route own-channel→200, other-user→403, no session→403; `triggerUserEvent` no-ops unconfigured / calls SDK configured; `notify()` fires trigger after insert and a failed trigger does NOT throw out of `notify()`; modal de-dupe renders once; RTL visual check (Playwright/agent-browser). Put ownership logic in `src/lib` (CI excludes `src/app/api/**`).

## Dependencies unblocked
#540 juz celebration modal (server side already merged — this is the missing client); #552 realtime celebrations (reuse `triggerUserEvent` + provider, new event name only).
