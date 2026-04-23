# Changelog

All notable changes to FURQAN Academy are documented here.

## 2026-04-23 — Retention system + Sprint 1/8 prep

Shipped 16 commits in a single session taking the retention feature from skeleton to self-healing, plus scaffolding two blocked sprints so they collapse to SDK-only work once keys arrive.

### Added — Retention (Sprint 5 app-side, plus polish phases)

- **`/api/retention/score`** endpoint. Daily scorer that computes `engagement_score` + `churn_risk_score` per student and upserts into `retention_signals`. Called by n8n cron on the Mac mini. Writes batch runs to `automation_logs` for observability.
- **`/admin/retention`** page. Ranked at-risk table with 5 intervention types (urgent contact, renewal offer, expiry reminder, re-engagement, weekly followup). Each intervention logs to `automation_logs` for audit trail and stamps `retention_signals.last_intervention_at`. Scorer's cooldown multipliers (×0.5 within 2 days, ×0.75 within 7 days) prevent over-contact. URL-param filters for risk tier / package state / intervention freshness.
- **Control Tower widget** — count of students with `churn_risk_score >= 60`, linked to retention page.
- **Risk badges** on `/admin/users` list + retention card on `/admin/users/[id]` with collapsible intervention history (last 10).
- **Risk hints on session detail pages** — admin, teacher, moderator session detail pages show the student's risk badge (only for ≥40).
- **Teacher at-risk widget** on teacher dashboard — shows this teacher's own students at risk, read-only.
- **Moderator at-risk widget** on moderator dashboard — platform-wide top 5.
- **Run Scorer Now button** — admin can manually trigger the scorer instead of waiting for cron.

### Added — Sprint 6 (teacher compliance)

- **Health metrics card** on `/admin/teachers/[id]` — 90-day punctuality, grading lag, evaluation completion rate, no-show rate, color-coded against thresholds.

### Added — Sprint 1 scaffolding (no SDK install required)

- **`src/lib/stripe/fulfillment.ts`** — `fulfillPackagePurchase()` creates Payment + StudentPackage + Invoice with best-effort rollback on failure.
- **`src/lib/stripe/refund.ts`** — `creditBackSession()` restores `sessions_used` via existing package state and writes a `payment_transactions` audit row.
- **`/api/stripe/webhook`** — full event router handling `checkout.session.completed`, logs every event to `automation_logs`. Signature verification stays as TODO pending SDK install.

### Added — Sprint 8 scaffolding (parent reports, AI-swappable slot)

- **`src/lib/reports/session-narrative.ts`** — `buildSessionNarrative(sessionId)` assembles structured report from session notes + homework + evaluation. The `narrative_paragraph` field is AI-swappable — template today, Claude tomorrow, no surrounding shape change.
- **`/api/reports/session/[id]`** (GET) — dual-auth (X-N8N-Secret or cookie admin/moderator/teacher) for n8n + UI inspection.
- **`/api/reports/session/[id]/send`** (POST) — accepts optional `narrative_paragraph` body override, runs dispatcher + writes `parent_reports` + emits `session.report_sent`.
- **Idempotency guard** — `automation_logs` prevents duplicate sends across admin button + n8n workflow + future Vercel Cron.
- **Admin "إرسال تقرير للوالد" button** on `/admin/sessions/[id]` once session has ended.

### Fixed

- **Blog OG route 1.01 MB Edge Function size limit.** Moved from `runtime="edge"` to Fluid Compute (default), added `dynamic="force-dynamic"` to skip prerender (Arabic `substFormat: 3` font feature breaks at build). Resolves ~1 hour of cascading production deploy failures.
- **`.claude/scheduled_tasks.lock` + `.claude/plans/` tracked by mistake** — now in `.gitignore`, skills stay tracked.

### Changed

- Documented that n8n moved from VPS to a Mac mini (`CLAUDE.md` + `automation/VPS_HANDOFF.md`). Endpoint `n8n.drdeeb.tech` unchanged.
- `ROADMAP.md` now marks Sprints 2-7 as ✅ SHIPPED and adds a Post-Roadmap Phases table for the new work.

### Patterns established

- **AI-swappable slot** — isolate generative output behind one field so swap from template to AI is a one-field change.
- **Shared retention helpers** (`src/lib/retention/ui.ts`) — extracted at the third caller per the Rule of Three.
- **Dual-auth endpoints** — `X-N8N-Secret` OR cookie role check on the same handler, one handler serves both n8n server-to-server and admin UI.
- **`automation_logs` as observability + idempotency store** — saves a schema migration for every audit need.
- **Fast-read cache + slow-write log** (`retention_signals.last_intervention_at` vs `automation_logs`) — CQRS at the table level without event sourcing overhead.

### Still blocked

- **Sprint 1 completion** — install `stripe` package, uncomment signature verification block, set env vars. ~15 min once keys arrive.
- **Sprint 8 AI narrative** — n8n workflow that calls Claude and POSTs to `/api/reports/session/[id]/send` with `narrative_paragraph` override. No app changes required.
- **n8n workflows on Mac mini** — retention daily cron, intervention fan-out, grading follow-up, eval compliance. All triggered off `POST` to existing app endpoints.
