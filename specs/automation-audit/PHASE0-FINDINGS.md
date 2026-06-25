# n8n Automation — Phase 0 Activation Audit (Findings)

**Run date:** 2026-06-25 · **Source:** live n8n (`n8n.drdeeb.tech`) + prod Supabase `automation_logs` (30-day window) + `platform_settings`.
**Script:** `scripts/n8n-activation-audit.mjs` (re-runnable; `--json` for machine output).
**Raw table:** `specs/automation-audit/phase0-rag-report.txt`.

This is the gate deliverable the plan required before building anything new: *which already-deployed "employees" are actually clocking in.*

---

## Headline (after fixing an audit-script truncation bug — see below)

| Bucket | Count | What it means |
|--------|-------|---------------|
| 🟢 Green | 20 | Active **and** writing success rows to `automation_logs`. Verified working. |
| 🟡 Amber | 18 | Active, no flag gate, zero `automation_logs` rows in 30 days — **all event-driven, idle by design** (see §3). |
| ⚫ Dark | 4 | Active in n8n but **flag-gated off** (`renewal_campaigns_enabled=false`). Intentional. |

Master flag `automation_enabled = true`. Other flags: `ai_parent_reports_enabled`, `teacher_quality_monitor_enabled`, `retention_automation_enabled` **on**; `renewal_campaigns_enabled` **off**.

**Net verdict: the automation layer is healthy.** Every scheduled cron is Green. The only non-Green workflows are (a) idle event-driven jobs waiting on real user traffic, and (b) 4 deliberately-disabled revenue campaigns.

---

## 1. The audit script had a truncation bug — fixed in this PR (root-cause finding)

The first run reported **11 Green / 27 Amber / 4 Dark** and flagged 8 scheduled crons (`cron-murajaah-due`, `retention-scorer`, `cron-email-health`, `cron-reconciliation`, `cron-audit-cleanup`, `daily-admin-digest`, `cron-cache-clear`, `cron-handoff-cleanup`) as Amber — "active but zero logs."

That was **a false alarm caused by the audit itself**, proven and then fixed:

- **Verification:** live n8n execution history for `cron-murajaah-due` showed it firing daily and succeeding (`status: success`). The reminders were running; the audit just wasn't counting their log rows.
- **Root cause:** `scripts/n8n-activation-audit.mjs` fetched `automation_logs` in a single request with `&limit=10000` and **no `order=` clause**. PostgREST enforces a server-side `db-max-rows` cap (commonly 1000) that silently overrides `limit`, and without an explicit order the truncated subset is non-deterministic — so sparse, low-volume workflows (a daily cron has ~30 rows/month) fell outside the returned page and read as zero.
- **Fix:** added a `sbGetAll()` helper that pages through every row via the `Range` header, and added `order=started_at.asc`. Re-running flipped all 8 crons to Green.

**Result of the fix:** 11→**20 Green**, 27→**18 Amber**, 4 Dark unchanged. There was never a telemetry gap; `automation_logs` was being written correctly all along.

> Lesson worth keeping: any "count rows from a Supabase table" check must paginate + order, or it lies once the table grows past the row cap. This pattern likely exists in other ad-hoc scripts — worth a sweep.

---

## 2. 🟢 Green (20) — confirmed firing + logging

Crons & high-traffic flows, all writing success rows in the 30-day window:
`platform-health-check`, `session-reminder-engine`, `workflow-failure-sentinel`, `no-show-detector`, `retention-scorer`, `session-auto-complete`, `cron-auto-complete-sessions`, `cron-n8n-healthcheck`, `cron-murajaah-due`, `cron-audit-cleanup`, `cron-email-health`, `cron-reconciliation`, `cron-cache-clear`, `cron-handoff-cleanup`, `daily-admin-digest`, `bunny-stuck-lessons`, `audit-log-enrichment`, `auto-decline-stale-bookings`, `realtime-kpi-alerting`, `dailyco-room-creation`. *(See raw report for per-workflow 30-day counts.)*

---

## 3. 🟡 Amber (18) — all event-driven, idle by design (no action)

Every remaining Amber fires only when a user/business event occurs. Prod currently holds **test/seed data only** (no real signups, milestones, CV approvals, missed sessions), so zero runs is the **correct** state, not a fault:

`role-based-welcome`, `cv-approval-notification`, `teacher-onboarding-nudges`, `learning-streak-encouragement`, `first-student-celebration`, `missed-session-parent-alert`, `package-expiry-countdown`, `homework-noncompletion-parent-alert`, `low-package-balance-alert`, `milestone-celebrations`, `inactivity-reengagement`, `parent-post-session-report`, `student-at-risk-detector`, `teacher-eval-compliance`, `teacher-quality-monitor`, `weekly-progress-digest`, `announcement-broadcaster`, `message-content-moderation`.

**Action:** none now. **Re-run this audit ~1 week after real traffic begins** — these should light up. Any that stay dark post-launch are the real investigation list.

---

## 4. ⚫ Dark (4) — intentional, owner decision

`abandoned-booking-recovery`, `package-renewal-campaign`, `trial-to-paid-conversion`, `upsell-higher-package` — gated by `renewal_campaigns_enabled=false`. To activate: set that flag `true` in admin → Platform Settings. **Business choice, not a defect.**

---

## Recommended next actions (owner-prioritized)

1. **Nothing is broken — no remediation required.** The audit's own bug created the only "red" signal; it's fixed.
2. **Re-run post-launch** (`node scripts/n8n-activation-audit.mjs`) once real users exist, to confirm the 18 event-driven workflows activate. That's the true validation gate for this layer.
3. **Dark 4:** decide whether to enable `renewal_campaigns_enabled`. Pure business choice.
4. **Optional hardening:** have the audit cross-check n8n execution history (not just `automation_logs`) so a genuine future logging gap is distinguishable from an idle event trigger. Lower priority now that the count is trustworthy.

## What was already shipped before this audit (context)

The earlier automation work (PRs #571/#572) delivered the Phase 1–4 build: dead-letter-nurse, event switchboard (`subscription-lifecycle`, `events-ack`), app-error-triage, credential-watcher, the 6 spec-028 AI/LLM workflows + admin eval-gate UI, parent-report dedup, and the Pusher doc cleanup. This Phase 0 audit confirms that layer is live and healthy.
