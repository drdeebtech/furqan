# API Routes Codemap

**Last Updated:** 2026-06-22
**Location:** `src/app/api/**` (72 routes)

API routes are integration endpoints: webhooks (Stripe, Daily, n8n, Bunny), cron jobs, admin endpoints, and client-side POST handlers.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  src/app/api/**                                            │
│  ├── {webhooks, cron, admin, auth, ...}/route.ts          │
│  ├── Thin verify/dispatch shells (webhook pattern)        │
│  └── Call domain/service functions, never inline logic    │
└──────────────────────────────────────────────────────────────┘
```

**Pattern for webhooks:**
1. Verify signature (fail-closed 401/403)
2. Parse payload + validate with Zod
3. Call handler function (domain or external service)
4. Return 2xx on success, non-2xx on failure
5. n8n/external systems handle retries

**No hardcoded business logic in route files.** Route handlers are dispatch shells; domain functions live in `src/lib/domains/`.

---

## Stripe Integration

| Route | Method | Purpose | Handler |
|-------|--------|---------|---------|
| `/api/stripe/webhook` | POST | Stripe event webhook (subscription lifecycle, payment events) | `src/lib/domains/billing/webhook-handlers.ts` |
| `/api/stripe/checkout` | POST | Create Stripe checkout session (Hifz subscription) | Calls `@/lib/stripe/client.ts` |
| `/api/stripe/checkout/single-session` | POST | Create Stripe checkout for instant booking | Calls `@/lib/stripe/client.ts` |
| `/api/stripe/portal` | POST | Redirect to Stripe customer portal (manage billing) | Calls Stripe SDK |

**Webhook handler (`/api/stripe/webhook`):**
- Verifies raw body against `STRIPE_WEBHOOK_SECRET` (fail-closed 400)
- Parses event type: `customer.subscription.updated`, `invoice.paid`, `payment_intent.succeeded`, etc.
- Delegates to `billingDomain.handleSubscriptionLifecycle()`, `handleInvoicePaid()`, etc.
- Returns 200 on success; Stripe retries on non-2xx

**Clients:**
- Service-role key for writes (plan upsert, event marking)
- Public key for customer portal redirect (no auth needed)

---

## Daily.co Integration (Video Sessions)

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/webhooks/daily` | POST | Session recording/room events | Verify `X-Daily-Signature` |

**Webhook behavior:**
- Receives: room created, participant joined/left, recording started/stopped
- Calls: session domain to update room state (optional; mostly for audit)
- Returns: 2xx

---

## Bunny CDN Integration

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/webhooks/bunny` | POST | Video encoding events (lessons uploaded) | Verify `AccessKey` (query param) |

**Webhook behavior:**
- Receives: video finished encoding, upload success/failed
- Calls: course domain to mark lesson available
- Cron: `/api/cron/bunny-stuck-lessons` — retry failed encodings

---

## n8n Integration (Automation Platform)

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/webhooks/n8n` | POST | n8n workflow callback (event listener) | Verify `x-n8n-signature-v1` (HMAC) |
| `/api/n8n/workflows` | GET | List workflows (admin view) | `requireAdmin()` + `VERCEL_ALLOWED_IPS` |
| `/api/n8n/workflow/[id]` | GET | Single workflow status | `requireAdmin()` |
| `/api/n8n/executions` | GET | Execution history (last 50) | `requireAdmin()` |
| `/api/n8n/executions/all` | GET | All executions (admin audit) | `requireAdmin()` |
| `/api/n8n/execution/[id]` | GET | Single execution logs | `requireAdmin()` |
| `/api/n8n/toggle` | POST | Enable/disable workflow | `requireAdmin()` |
| `/api/n8n/auto-restart` | POST | Force restart failed workflow | `requireAdmin()` |
| `/api/n8n/admin-actions` | POST | Trigger admin workflow (user management, retention, etc.) | `requireAdmin()` |

**Webhook (`/api/webhooks/n8n`):**
- Receives: automation events (billing cycle grant, retention batch, broadcasts)
- Calls: `emitEvent()` handlers for each event type
- n8n retries non-2xx; failures land in `automation_logs` with `status='failed'`

**Admin routes:**
- Proxy to n8n cloud API (auth via `N8N_API_KEY`)
- Used by `/admin/automation` page

---

## Cron Jobs

Cron routes trigger background jobs. Secured by `Authorization: Bearer CRON_SECRET` (Vercel Only).

### Session & Booking

| Route | Interval | Purpose | Calls |
|-------|----------|---------|-------|
| `/api/cron/auto-complete-sessions` | Daily (23:00 UTC) | Mark overdue sessions as completed | Session domain, finalize attendance |
| `/api/cron/murajaah-due` | Daily (09:00 UTC) | Compute students with due murajaah (SM-2) | Murajaah domain + notify |
| `/api/cron/murajaah-compute` | Daily (22:00 UTC) | Recalculate SM-2 intervals (scheduled from n8n) | Murajaah domain, batch update |

### Billing & Subscriptions

| Route | Interval | Purpose | Calls |
|-------|----------|---------|-------|
| (Stripe webhook primary) | Event-driven | Invoice paid, subscription updated | Billing domain webhook handlers |
| (n8n cron workflow) | Monthly (1st) | Grant monthly credits (`grantCycle`) | Billing domain orchestrator |

### Reports & Month-Close

| Route | Interval | Purpose | Calls |
|-------|----------|---------|-------|
| `/api/cron/reconciliation` | Daily (midnight) | Detect month-close, finalize reports | Reports domain, finalize attendance |
| `/api/cron/email-health` | Daily | Check email delivery logs | Email domain |

### Retention & Engagement

| Route | Interval | Purpose | Calls |
|-------|----------|---------|-------|
| `/api/cron/retention-score` | Daily (06:00 UTC) | Compute student retention risk scores | Retention scoring domain, n8n trigger |
| `/api/cron/honor-board-compute` | Weekly | Compute leaderboard rankings | Honor board domain |

### Admin & Maintenance

| Route | Interval | Purpose | Calls |
|-------|----------|---------|-------|
| `/api/cron/cache-clear` | Hourly | Clear stale caches (feature flags, plans) | Edge config, revalidate paths |
| `/api/cron/audit-cleanup` | Daily (02:00 UTC) | Archive old audit logs (>90 days) | Audit log domain |
| `/api/cron/handoff-cleanup` | Daily | Delete expired OAuth handoff codes | Auth domain |
| `/api/cron/n8n-healthcheck` | Every 15 min | Verify n8n is responding | n8n admin API |
| `/api/cron/process-broadcasts` | Every 5 min | Send queued announcements | Notifications domain |

---

## Authentication Routes

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/auth/callback/google` | GET | Google OAuth callback | `code` param (exchanged for token) |
| `/api/auth/handoff/[code]` | GET | One-time auth code (web→app handoff) | Session cookie + verified code |
| `/api/auth/logout` | POST | Clear session, revoke tokens | Session (already authenticated) |
| `/api/auth/test-login` | POST | Dev-only: bypass auth for testing | Only in `NODE_ENV=development` |

**OAuth flow:**
1. Frontend redirects to Google
2. Google redirects to `/api/auth/callback/google?code=...`
3. Route exchanges code for token, creates Supabase session
4. Redirects to `/student/dashboard` or `/teacher/dashboard`

**Handoff (web→app):**
- Web generates one-time code via `/api/auth/handoff/[code]`
- Mobile app calls with code, receives session JWT
- Code expires in 5 minutes

---

## User Management & Scheduling

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/guardian/children` | GET | Fetch parent's linked children | `requireRole('parent')` |
| `/api/guardian/add-child` | POST | Link child to parent account | `requireRole('parent')` |
| `/api/scheduling/my-assignment` | GET | Fetch student's current teacher (halaqas) | `requireRole('student')` |
| `/api/scheduling/assign-teacher` | POST | Admin: assign teacher to student | `requireAdmin()` |
| `/api/scheduling/available-slots` | GET | List teacher availability for booking | Public read (RLS) |
| `/api/scheduling/book-slot` | POST | Student: book a scheduled slot (halaqas) | `requireRole('student')` |
| `/api/scheduling/join-halaqa` | POST | Student: join a halaqa (group class) | `requireRole('student')` |
| `/api/scheduling/admin/assignment-history` | GET | Admin: audit teacher assignments | `requireAdmin()` |
| `/api/scheduling/admin/halaqa-roster` | GET | Admin: list students in halaqa | `requireAdmin()` |
| `/api/scheduling/admin/reassign-teacher` | POST | Admin: force reassign teacher | `requireAdmin()` |

---

## Attendance & Excuses

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/attendance/record` | POST | Record student attendance (teacher) | `requireRole('teacher')` |
| `/api/attendance/[studentId]` | GET | Fetch student attendance history | `requireRole('teacher')` or `requireAdmin()` |
| `/api/excuses/submit` | POST | Student: submit absence excuse | `requireRole('student')` |
| `/api/excuses/[id]/decide` | POST | Admin: approve/reject excuse | `requireAdmin()` |

---

## Bookings & Sessions

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/bookings` | GET | List bookings (filtered by user) | Session-based RLS |
| `/api/single-sessions/my-bookings` | GET | Student: my instant session bookings | `requireRole('student')` |
| `/api/single-sessions/assessment-specialists` | GET | List available assessment specialists | Public read (RLS) |
| `/api/admin/single-sessions/prices` | GET | Admin: current instant session pricing | `requireAdmin()` |

---

## Billing & Subscriptions

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/subscriptions/upgrade-tier` | POST | Student: upgrade to higher tier | `requireRole('student')` |
| `/api/subscriptions/schedule-tier-change` | POST | Student: schedule tier downgrade (future) | `requireRole('student')` |

---

## Reports & Monitoring

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/reports/[studentId]/monthly/[year]/[month]` | GET | Monthly parent report | `requireRole('parent')` or `requireAdmin()` |
| `/api/reports/[studentId]/notes` | GET | Session notes for student | `requireRole('teacher')` or `requireAdmin()` |
| `/api/reports/session/[id]` | GET | Single session report (notes, evaluation) | Teacher or admin |
| `/api/reports/session/[id]/send` | POST | Email session report to parent | `requireRole('teacher')` |
| `/api/retention/score` | GET | Fetch retention risk scores (admin dashboard) | `requireAdmin()` |
| `/api/honor-board` | GET | Fetch leaderboard (rankings, opt-outs respected) | Public read (RLS) |
| `/api/honor-board/opt-out` | POST | Student: hide self from honor board | `requireRole('student')` |

---

## Admin Tools

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/admin/control-tower/snapshot` | GET | System health snapshot (CPU, DB, webhooks) | `requireAdmin()` |
| `/api/catalog/hifz` | GET | Fetch Hifz plan catalog (mirror from Stripe) | Public read |
| `/api/certificates/[studentId]` | GET | Fetch student's Ijazah certificates | Student or teacher or admin |
| `/api/payroll/run` | POST | Admin: trigger monthly teacher payroll | `requireAdmin()` |
| `/api/payroll/payouts` | GET | List payroll records | `requireAdmin()` |
| `/api/sentry-metrics-test` | POST | Dev: trigger test error to Sentry | Dev only |
| `/api/sentry-watch/notify` | POST | Sentry: webhook alert (errors, releases) | Verify `X-Sentry-Hook-Signature` |
| `/api/preview-banner/dismiss` | POST | User: dismiss Vercel preview banner | Session |

---

## Response Patterns

### Success Response (2xx)
```json
{
  "success": true,
  "data": {...} // optional
}
```

### Error Response (4xx / 5xx)
```json
{
  "success": false,
  "error": "غير مصرح",
  "code": "UNAUTHORIZED"
}
```

### Webhook Acknowledge (2xx)
```
HTTP 200 OK
(body optional or { success: true })
```

---

## Error Handling

**Webhook pattern (fail-closed):**
```typescript
// Step 1: Verify signature
if (!verifySignature(body, signature)) {
  return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
}

// Step 2: Parse + validate
const event = z.object({...}).parse(payload)

// Step 3: Call handler
try {
  await handler(event)
  return NextResponse.json({ success: true })
} catch (error) {
  logError('webhook failed', { error, routeName: 'stripe.webhook' })
  return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
}
```

**Cron pattern:**
```typescript
// Verify CRON_SECRET
if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

// Run job
try {
  await cronJob()
  return NextResponse.json({ success: true })
} catch (error) {
  logError('cron failed', { error, routeName: 'cron.auto-complete-sessions' })
  return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
}
```

---

## Related Maps

- [domains.md](./domains.md) — business logic that API routes call
- [actions-and-views.md](./actions-and-views.md) — server actions for client-initiated requests
- [app-screens.md](./app-screens.md) — user-facing screens

## See Also

- `src/lib/logger.ts` — `logError(message, { error, routeName, ... })`
- `src/lib/stripe/client.ts` — Stripe SDK initialization
- `.github/workflows/` — Vercel cron configuration
- CONTEXT.md § 3 — security principles (RLS, service-role key, input validation)
