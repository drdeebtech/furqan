# Exception Playbooks

> What admins/moderators do when something goes wrong.
> Each playbook: symptom → diagnosis steps → resolution → post-mortem note.

---

## PB-01 · Daily.co room creation failed

**Symptom**: booking confirmed but session has no `room_url`, or student/teacher report blank video screen.

**Diagnose**
1. `/admin/sessions` → find session → check `room_url`, `room_expires_at`
2. `/admin/n8n` → search `furqan-session-room-creation` → last execution status
3. Check Daily.co dashboard for outage (status.daily.co)
4. Verify `DAILY_API_KEY` is present in Vercel env

**Resolve**
- Transient Daily.co error → trigger **Recreate Room** button on session row (`adminCreateRoom`)
- `DAILY_API_KEY` missing/invalid → rotate, update Vercel env, redeploy, then recreate
- Persistent outage → switch to backup meeting link in session notes; message participants via notify()

**Post-mortem**
- If ≥3 failures in 1h → open incident note in `automation_dead_letter` review queue

---

## PB-02 · Teacher missed a session

**Symptom**: `session.no_show` event fired with `no_show_party=teacher`, or parent complaint.

**Diagnose**
1. `/admin/sessions` → filter `status=no_show` for today
2. Check `session_presence_events` for both participants' join attempts
3. Contact teacher via Telegram or phone

**Resolve**
1. Do **not** deduct student's package session (revert `deduct_package_session`)
2. Offer student immediate re-booking with priority slot
3. Flag teacher profile: `/admin/teachers/{id}` → add internal note
4. If repeated (≥2 in month): trigger `furqan-teacher-quality-monitor` review

**Parent messaging** — use template `T-SESS-NO-SHOW-TEACHER`. Always apologize and confirm no-cost re-booking.

---

## PB-03 · Payment succeeded but package not fulfilled

**Symptom**: Stripe webhook shows `checkout.session.completed`, but student has no active `student_packages` row.

**Diagnose**
1. `/admin/payments` → find payment → check `fulfilled` flag
2. Stripe Dashboard → confirm webhook delivery status
3. Supabase logs → search for errors in `stripe webhook` function

**Resolve**
- Webhook never arrived → replay from Stripe Dashboard
- Webhook arrived, processing errored → manually create `student_packages` row, set `payment_id` to Stripe ID, notify student with `T-PAY-SUCCESS`
- Never ignore — an unfulfilled payment is a refund obligation

**Post-mortem**
- File in `automation_dead_letter` with full Stripe event ID
- If same root cause twice → fix the webhook handler; don't keep manually reconciling

---

## PB-04 · Parent complaint about teacher

**Symptom**: parent messages admin or flagged message in `/admin/notifications`.

**Triage (Tier 1–4 from AUDIT §7)**
| Tier | Meaning | Response SLA |
|------|---------|--------------|
| 1 | Minor clarification | 24h |
| 2 | Needs attention | 4h |
| 3 | Concern (unprofessional conduct) | 1h |
| 4 | Escalation (safety, severe) | immediate |

**Resolve (Tier 2+)**
1. Pull session recording + teacher's post-session notes
2. Read last 3 `session_evaluations` for this student↔teacher pair
3. Check teacher's other student retention (is this isolated?)
4. Reply to parent within SLA — even if only to acknowledge
5. If pattern: `/admin/teachers/{id}` → flag → trigger CV/quality re-review

**Never**: share another student's info with a complaining parent.

---

## PB-05 · n8n workflow in failure loop

**Symptom**: Telegram spam from `T-ADMIN-WORKFLOW-FAILURE`, or `/admin/n8n` shows repeated red executions.

**Diagnose**
1. `/admin/n8n` → open workflow → read last error
2. Toggle off temporarily if it's flooding
3. Check `automation_dead_letter` — if same idempotency_key repeated, dedup is broken

**Resolve**
- Transient (upstream API 5xx) → leave off for 15m then re-enable
- Real bug → fix n8n workflow logic, create new version (`-v2`), roll flag, retire old
- Upstream quota exhausted → pause until reset; notify affected users via template if SLA-critical

**Post-mortem** — in AUTOMATION_REGISTRY.md add a "known failure modes" line for this workflow.

---

## PB-06 · Booking conflict / double booking

**Symptom**: two students booked the same teacher slot; `furqan-booking-conflict-detector` flagged.

**Resolve**
1. `/admin/bookings` → filter by teacher → identify overlapping slots
2. Prefer moving the later-booked student (their choice of: reschedule / different teacher)
3. Offer credit session as goodwill
4. Never silently reassign — always confirm with student first

---

## PB-07 · Delivery failures spiking

**Symptom**: `/admin/notifications` → `message_delivery_log` shows `status=failed` ratio > 10%.

**Diagnose**
1. Group failures by `recipient_channel` — is it one channel or all?
2. `in_app` failing → RLS regression or Supabase outage
3. `whatsapp` failing → token expired or quota hit
4. `email` failing → Resend API issue

**Resolve**
- Pause affected workflow(s) to stop the bleed
- Fix root cause (rotate token / restore DB / wait out outage)
- Replay from `automation_dead_letter` once channel is healthy
- Never send duplicate notifications — idempotency_key must guard replay

---

## PB-08 · Student locked out / wrong role

**Symptom**: user can't access dashboard or is on wrong dashboard.

**Diagnose**
1. `/admin/users` → find user → check `role`, `is_active`
2. Check `audit_log` for last role/status change
3. Verify email is confirmed in Supabase Auth

**Resolve**
- Wrong role: update via `/admin/users/{id}` (role change is audited)
- Inactive: reactivate, notify with welcome-back message
- Email unconfirmed: resend confirmation via Supabase Auth

---

## PB-09 · CV review stuck

**Symptom**: teacher reports CV pending > 48h; teacher list shows many `pending` statuses.

**Resolve**
1. `/moderator/cv-review` → filter `pending`, sort by `cv_submitted_at asc`
2. Process oldest first
3. If moderator capacity is overloaded: admin takes overflow via `/admin/teachers/cv`
4. Target SLA: 24h for CV review; 48h is the escalation line

---

## PB-10 · Anyone reports "nothing works"

**Symptom**: platform-wide user reports.

**Diagnose (in order)**
1. `/admin/control-tower` — red widgets tell the story
2. Vercel → last deployment status
3. Supabase project status page
4. `/admin/n8n` → health audit
5. Daily.co status
6. Stripe status (if payment flow live)

**Communicate**
- If confirmed outage: post status via `furqan-messaging-announcement-broadcaster` with `urgent=true`
- Don't fix silently — users calm down when they know the team is on it

---

## Authoring rules for new playbooks

1. **Every playbook has an ID** (`PB-NN`) and is numbered consecutively.
2. **Symptom first** — written as the thing the user/admin actually observes.
3. **Diagnosis steps are ordered and runnable** — no "check the system" vagueness.
4. **Resolution is explicit** — name the button, URL, or server action.
5. **End with a post-mortem hook** when root-cause work is needed.
6. **Link to the templates in COMMUNICATION_TEMPLATES.md** by ID, not prose.
