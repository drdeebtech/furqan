# Quickstart: Reports, Gamification & Notifications (Spec 023)

**Phase**: م٦ | **Generated**: 2026-06-16

---

## Scenario 1 — Monthly Report Generation (Idempotent)

1. Seed: student with active subscription, billing month closed.
2. Emit `FurqanEvent.MonthlyReportReady` with `{studentId, year: 2026, month: 6}`.
3. Assert: one `monthly_reports` row with `student_id` and `period_year=2026`, `period_month=6`.
4. Assert: one `automation_logs` row with key `report:{studentId}:2026:6` and `status='succeeded'`.
5. Assert: one `notifications` row for the guardian (report-ready).
6. **Replay** the same event.
7. Assert: still only one `monthly_reports` row; `automation_logs` row now has `status='skipped'`; no duplicate notification.

---

## Scenario 2 — Juz Certificate (Canonical Range + Idempotency)

1. Seed: student completes juz 30.
2. Emit `FurqanEvent.CertificateEarned` with `{studentId, type: 'appreciation_juz', milestoneKey: '30'}`.
3. Assert: one `certificates` row with `certificate_type='appreciation_juz'`, `milestone_key='30'`.
4. Assert: `cited_range_start` and `cited_range_end` exactly match `src/lib/quran/ayah-counts.ts` boundaries for juz 30 (Surah 78 Al-Naba ayah 1 → Surah 114 An-Nas ayah 6).
5. Assert: certificate renders with Arabic RTL fields preserved.
6. **Replay** the same event.
7. Assert: still one certificate row; `automation_logs` key `cert:{studentId}:appreciation_juz:30` has `status='skipped'`.

---

## Scenario 3 — Dunning Notification (Idempotent Delivery)

1. Emit `FurqanEvent.PaymentFailed` with `{subscriptionId, attempt: 1}`.
2. Assert: one `notifications` row for the guardian with type matching dunning/pre-suspension alert, channels include `in_app` and `email`.
3. Assert: `automation_logs` entry with key `notif:{recipientId}:payment_failed:{subscriptionId}-1` (canonical `notif:{recipientId}:{trigger}:{subjectKey}`) and `status='succeeded'`.
4. **Replay** same event (simulate n8n retry).
5. Assert: no duplicate notification; `automation_logs` key has `status='skipped'`.

---

## Scenario 4 — WhatsApp Delivery Failure (Fail-Closed)

1. Configure n8n stub to return HTTP 500 for WhatsApp sends.
2. Emit any notification event that routes to WhatsApp channel.
3. Assert: `automation_logs` entry has `status='failed'` (NOT `'succeeded'`).
4. Assert: Sentry error captured (check Sentry test DSN or mock).
5. Assert: the notification row exists but its WhatsApp delivery is not marked succeeded.
6. **Retry** the event after fixing the n8n stub.
7. Assert: idempotency key allows retry (status was 'failed', not 'succeeded'); delivery succeeds on retry.

---

## Scenario 5 — Honor Board Opt-Out

1. Seed: student appears on honor board (`is_opted_out = false`).
2. `GET /api/honor-board` → assert student's `displayName` is in results.
3. `PATCH /api/honor-board/opt-out` with `{optedOut: true}` as the student.
4. Assert: `honor_board_entries.is_opted_out = true` for that student.
5. `GET /api/honor-board` → assert student no longer appears in results.
6. Guardian opts back in on behalf of minor: `PATCH /api/honor-board/opt-out` with `{studentId: childId, optedOut: false}`.
7. Assert: student reappears on board.
