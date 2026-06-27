# Spec 029 — Web Push Notifications (PWA)

Closes #538. Implements opt-in web push so mobile hifz students get reminders when
the tab is closed: session reminders 15 min before a booking, missed-follow-up
alerts, juz-milestone celebrations.

This doc is the build sheet. **Claude planned it; Codex implements the app-side
plumbing.** The n8n trigger wiring is specified but built separately.

---

## Three-lens check
- 🛠 Engineer: new RLS table, two API routes, a server send helper, service-worker
  push handlers, opt-in UI. New server-only secret (VAPID private key).
- 📖 Quran teacher: notification copy is Arabic-first, RTL. No Quran text is generated
  or sent in a push body — only references (e.g. "مراجعة سورة البقرة ١–٥") echoed back
  from stored, verified data.
- 🎓 Platform expert: daily habit product, mobile-first GCC/South Asia. Push must
  degrade gracefully when denied or unsupported, and must be honest about iOS.

---

## Decisions (settled — override before Codex runs if you disagree)

1. **Library:** `web-push` (npm). Battle-tested, handles VAPID + payload encryption.
   No hand-rolled crypto.
2. **VAPID keys = new secrets.**
   - `VAPID_PRIVATE_KEY` — server-only (Vercel env + `.env.local`). NEVER `NEXT_PUBLIC_*`,
     never committed.
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — public (safe in the browser bundle).
   - `VAPID_SUBJECT` — `mailto:` contact, server-only. Default `mailto:support@furqan.today`.
   - Generated once via `npx web-push generate-vapid-keys`. Setup step writes them
     straight into `.env.local` (gitignored) and Vercel env — the private key is
     never echoed to chat or logs.
3. **iOS reality (honest):** Safari only delivers web push when the PWA is installed
   to the home screen (`display-mode: standalone`). The opt-in UI MUST detect iOS
   Safari that is NOT installed and show an "add to home screen" hint instead of a
   dead permission prompt. This is the only way criterion "push on mobile Safari"
   is achievable.
4. **Relationship to #526 (Pusher):** complementary, not duplicate. #526 = in-app
   real-time while the tab is open. #538 = OS-level push while the tab is closed.
   Ship independently.
5. **Scope of THIS spec (app-side plumbing):** table + RLS, subscribe/unsubscribe
   routes, service-worker handlers, opt-in UI, and a server send helper + one
   internal endpoint n8n calls to fan out a push. The n8n workflows that decide
   *when* to call it are specified in "n8n wiring" but built in a follow-up.

---

## Data model

New migration `supabase/migrations/20260628000000_push_subscriptions.sql`
(bump the date if a later migration lands first — must sort after
`20260627000000_parent_reports_error_column.sql`).

```sql
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  keys_p256dh text not null,
  keys_auth   text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- Owner can see/insert/delete their own subscriptions.
create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);

create index push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
```

Writer audit (per repo rule — enumerate writers before the guard):
- **Insert/delete:** the authenticated user via `/api/push/(un)subscribe` — covered by
  owner RLS using the session `auth.uid()`. `userId` comes from the session, never input.
- **Read for sending:** the server send helper uses `createAdminClient()` (service role,
  bypasses RLS) — it must look up *other* users' subscriptions to push to them. This is
  the one legitimate admin read; justify it in a comment.
- **Delete on 410 Gone:** the send helper deletes dead endpoints (push service returned
  404/410) via the admin client. Justify inline.

Run `npm run db:types` after the migration so `push_subscriptions` lands in
`src/types/database.ts` (hand-corrected layer — review the diff, don't blind-regen).

---

## Files to build

1. **`supabase/migrations/20260628000000_push_subscriptions.sql`** — above.

2. **`src/lib/push/vapid.ts`** — reads the three env vars, calls
   `webpush.setVapidDetails(...)` once (module-load), exports the configured
   `webpush` client. Fail-soft: if `VAPID_PRIVATE_KEY`/public key are unset, export
   `null` and log once — never throw at import (mirrors the PostHog fail-soft pattern).

3. **`src/lib/push/send.ts`** — `sendPushToUser(userId, payload)`:
   - admin-client lookup of the user's subscriptions,
   - `webpush.sendNotification` per endpoint,
   - on 404/410 delete that row,
   - returns `{ sent, failed }`. Never throws to the caller (fail-soft, logError on
     unexpected errors with `tag: "push"`).
   - `payload` is `{ title, body, url?, tag? }`. Body text is caller-supplied,
     already-verified strings — no Quran generation here.

4. **`src/app/api/push/subscribe/route.ts`** — POST. zod-validate the
   `PushSubscription` JSON (`endpoint`, `keys.p256dh`, `keys.auth`). `user_id` from
   `supabase.auth.getUser()`, NEVER from body. Upsert on `endpoint`. 401 if no session.

5. **`src/app/api/push/unsubscribe/route.ts`** — POST. Delete the row for
   `{ endpoint }` owned by the session user.

6. **`src/app/api/push/send/route.ts`** — POST, **internal**. Called by n8n to fan
   out a push. Auth: `Authorization: Bearer ${CRON_SECRET}` (reuse the existing cron
   secret pattern — fail-closed 401 on mismatch, timing-safe compare). Body:
   `{ userId, title, body, url?, tag? }` (zod). Calls `sendPushToUser`. This is the
   seam n8n hits; do NOT trigger sends from app code paths in this spec.

7. **`public/sw.js`** — EXTEND the existing service worker (do not replace). Add:
   - `self.addEventListener("push", ...)` → `showNotification(title, { body, dir: "rtl",
     lang: "ar", icon: "/logo-192.png", badge: "/logo-192.png", data: { url }, tag })`.
   - `self.addEventListener("notificationclick", ...)` → focus an existing client on
     `data.url` or open it. `dir: "rtl"` + `lang: "ar"` satisfy the RTL-Arabic criterion.
   - Bump the cache-version constant at the top so installed PWAs pick up the new SW.

8. **`src/components/shared/push-optin.tsx`** — `"use client"`. A small opt-in control
   (bell button or settings toggle):
   - Feature-detect `"serviceWorker" in navigator && "PushManager" in window`.
   - **iOS Safari not-installed branch:** if iOS and not `navigator.standalone` /
     not `display-mode: standalone`, render the "أضف التطبيق إلى الشاشة الرئيسية"
     (Add to Home Screen) hint instead of a permission prompt.
   - On opt-in: register SW (if not already), `Notification.requestPermission()`,
     `registration.pushManager.subscribe({ userVisibleOnly: true,
     applicationServerKey: <NEXT_PUBLIC_VAPID_PUBLIC_KEY urlBase64ToUint8Array> })`,
     POST to `/api/push/subscribe`.
   - On denied: store nothing, show a calm "notifications off" state. No nagging.
   - All visible strings Arabic-first, RTL.

9. **Render the opt-in** in the student dashboard surface (next to where
   `PostHogIdentify` is mounted in `src/app/student/layout.tsx`) and optionally the
   teacher layout. Students are the priority per the issue.

10. **`package.json`** — add `web-push`; `@types/web-push` to devDependencies.

---

## n8n wiring (specified, built in follow-up — NOT in this PR)

Three triggers call `POST /api/push/send` with `Bearer CRON_SECRET`:
- **Session reminder:** scheduled check (every 5 min) for bookings starting in 15 min
  → send to the student. Or emit `booking.reminder` 15 min prior and route it.
- **Missed follow-up:** existing follow-up-overdue path → push.
- **Juz milestone:** on the juz-completion event (see #540) → celebratory push.

Add any new event names to `WEBHOOK_ROUTES` in `src/lib/automation/emit.ts` (typed
taxonomy — a raw string is a compile error). Do this when the n8n side is built.

---

## Acceptance criteria (from #538)
- [ ] Student can opt-in to web push.
- [ ] Push received when tab is closed (mobile Chrome; iOS Safari **only when PWA
      installed** — opt-in UI guides the install).
- [ ] Session reminder arrives 15 min before booking start (n8n follow-up; the
      `/api/push/send` seam is ready in this PR).
- [ ] Graceful degradation when permission denied or push unsupported.
- [ ] RTL Arabic notification text (`dir: "rtl"`, `lang: "ar"`, Arabic copy).

## Verify before "done"
- `npx tsc --noEmit` clean, `npm run lint`, `npm run build` (not just tsc — server/client
  boundary; the new route + client component must survive Turbopack).
- `npm run test:unit`.
- Apply the migration on a from-zero local DB (`supabase db reset` + bootstrap) to catch
  replay bugs.
- Manual: subscribe on desktop Chrome, hit `/api/push/send` with the cron secret, confirm
  the notification shows with RTL Arabic text and the click opens the right URL.

## Out of scope
- The n8n workflows themselves (timing logic).
- #526 Pusher in-app real-time.
- Notification preference center (per-type toggles) — future enhancement.
