# n8n Workflow Specs (operator import)

Ready-to-build n8n workflows for the in-repo features that hand work to n8n.
The app side of each is complete and merged; these are the one-time imports that
close the loop. n8n runs on the Mac mini (`n8n.drdeeb.tech`) per CLAUDE.md.

All HTTP calls authenticate with the canonical dual-auth header used by every
cron route: `X-N8N-Secret: {{ $env.N8N_WEBHOOK_SECRET }}`.

---

## 1. Broadcast drainer (audit H7)

**Why:** the admin "send notification" action enqueues a `notification_broadcasts`
row and starts delivery immediately via `after()`. This cron reliably finishes
any broadcast whose audience was too large to complete in one function budget.
The route is idempotent + resumable (it resumes from the row's id cursor), so
running it on a schedule is safe.

**Workflow:**
- **Trigger:** Cron / Schedule node — every 2 minutes (`*/2 * * * *`).
- **HTTP Request node:**
  - Method: `GET`
  - URL: `https://www.furqan.today/api/cron/process-broadcasts`
  - Header: `X-N8N-Secret` = `{{ $env.N8N_WEBHOOK_SECRET }}`
  - Response: JSON `{ ok, processed, results: [{ id, done, sent, failed }] }`
- Activate. (No body; nothing to map. Optional: alert on non-200.)

> Without this, broadcasts to a very large audience still *start* sending via
> `after()` but a remainder beyond the function budget would wait. For typical
> targeted broadcasts `after()` finishes on its own.

---

## 2. package.credit_granted consumer (audit #343)

**Why:** `grantCredit` emits `package.credit_granted` (state-change → emitEvent
rule). The in-app `notify()` + `audit_log` already cover user/operator
visibility; this workflow just gives the event a real consumer so the dispatch
stops logging a failed delivery.

**Workflow:**
- **Trigger:** Webhook node — `POST /webhook/furqan-package-credit-granted`
  (path must match `WEBHOOK_ROUTES["package.credit_granted"]` in
  `src/lib/automation/emit.ts`).
- Verify the signature header the app sends (same HMAC pattern as the other
  `furqan-*` webhooks — see an existing `furqan-booking-*` workflow for the
  verify node).
- Payload: `{ event, entity_type:"student_package", entity_id, actor_id,
  data:{ student_id, sessions_granted, sessions_total, granted_by } }`.
- Minimal body: respond `200`. Optional: post a Telegram note to the operator
  channel for the audit trail. No downstream automation is required.

---

## Notes
- These are the only external steps to fully close the maturation/hardening
  campaign's n8n-dependent items. Everything else is merged + applied in-repo.
- After importing, add each to `AUTOMATION_REGISTRY.md` so the registry stays the
  source of truth.
