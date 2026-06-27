# Spec 030 — Student Re-engagement Nudge (7-day lapsed)

Closes #551. Detects active students with no session in 7 days and sends a
personalized, encouraging nudge (web push + in-app), respecting quiet hours and
opt-out, with a per-student cooldown.

Build sheet. **Claude planned it; Codex implements.** The n8n side is a trivial
cron trigger; all detection/personalization/dispatch lives in the app.

---

## Headline decision (advisor)

The issue title says "n8n workflow," but building detection + per-student copy in
n8n would re-implement existing app code **and push student PII (names, surah:ayah)
into n8n execution logs**. Correct shape: a thin authenticated app endpoint that
does everything server-side; n8n is reduced to a cron that POSTs to it.

---

## Three-lens check
- 🛠 Engineer: no PII in n8n; idempotent (cooldown predicate + daily `automation_logs` key); rate-safe chunked fan-out; fail-loud via `logError`; dual-auth (`X-N8N-Secret`/`Bearer CRON_SECRET`).
- 📖 Quran teacher: copy is encouraging, not nagging; surah name from canonical `src/lib/quran/surahs.ts` only (never model-generated); never overstate progress — echo the last recorded ayah, fall back to a generic warm nudge if no progress row.
- 🎓 Platform: Arabic-RTL copy (test rendering); motivation as continuation not guilt; deep-link to a clear next step; respects quiet hours so a nudge never fires at 2am.

---

## What already exists (reuse — do NOT rebuild)
- `retention_signals` table: per-student `last_session_at`, `churn_risk_score`, `last_intervention_at`, `intervention_type`. Populated nightly by `scoreRetentionBatch()` (`src/lib/actions/retention-batch.ts`), which already handles the PostgREST pagination gotcha (`.range()` + `.order("id")`, CHUNK=1000).
- Nightly cron wired: n8n → `/api/cron/retention-score` (`0 4 * * *`, dual-auth).
- Web push: `POST /api/push/send` (Bearer `CRON_SECRET`) → `sendPushToUser(userId, {title, body, url?, tag?})` (`src/lib/push/send.ts`); prunes dead endpoints.
- In-app + quiet hours: `notify()` (`src/lib/notifications/dispatcher.ts`) reads `communication_preferences`; `notif_type` enum includes `"reminder"`.
- Event taxonomy already has `retention.intervention_triggered` (gated by `retention_automation_enabled`).
- `automation_logs` idempotency-key pattern.

## Decisions (settled — override before build if you disagree)
1. **Thin app endpoint** `POST /api/retention/nudge` + logic in `src/lib/actions/retention-nudge.ts` (logic in `src/lib` not the route — CI coverage excludes `src/app/api/**`). Dual-auth identical to `/api/retention/score`.
2. **No new table, no new event.** Reuse `retention_signals.last_intervention_at` + `intervention_type='reengagement_7d'` as the cooldown record; reuse the existing `retention.intervention_triggered` event per nudge.
3. **Detection** (paginated, `.range()` + `.order("id")`):
   `last_session_at < now()-7d AND last_session_at >= now()-60d AND (last_intervention_at IS NULL OR last_intervention_at < now()-14d)`, filtered to active students (`profiles.is_active`, `deleted_at IS NULL`, `role='student'`). Constants named (`7d`, `14d` cooldown, `60d` cap).
4. **Idempotency, two layers:** the cooldown predicate + one `automation_logs` row per run (`idempotency_key='reengagement-nudge-<YYYY-MM-DD>'`). After dispatch, stamp `last_intervention_at=now(), intervention_type='reengagement_7d'`.
5. **Channels:** `notify({type:"reminder", urgent:false, ...})` (quiet-hours/important-only enforced for free) + `sendPushToUser(...)`. **Gate the push behind the same prefs/quiet-hours the dispatcher uses** — the raw push route bypasses `communication_preferences`, so do not push to a user in quiet hours.
6. **Master gate:** endpoint no-ops (logged) when `automation_enabled`/`retention_automation_enabled` is off.

## n8n workflow (`furqan-reengagement-nudge`)
1. Schedule Trigger — daily `0 6 * * *` (after the 04:00 scorer).
2. HTTP Request — `POST {APP_URL}/api/retention/nudge`, header `X-N8N-Secret`.
3. IF status≠2xx → admin error alert (no silent failure).

## OPEN DECISION (confirm before build)
- Is there a push/marketing opt-out column on `communication_preferences` beyond `in_app_enabled`/quiet-hours? If yes, honor it. If no, reuse those two.

## Risks + test plan
- **Push bypasses prefs** → could fire in quiet hours. Mitigation: gate push on same prefs. Verify: seeded lapsed student in quiet hours → no push, no in-app.
- **Re-nudge storm** if the stamp fails post-send → bounded by cooldown + daily key; stamp with error logging.
- **Timezone**: dispatcher compares quiet hours in UTC (documented limitation) — out of scope.
- **Happy path:** seed `last_session_at=now()-8d` + a progress row + push sub + permissive prefs → 1 push, 1 `notifications` row (`reminder`), `last_intervention_at` stamped, 1 `automation_logs` `succeeded`, copy contains the canonical surah name.
- **Idempotency:** run twice same day → second nudges 0.
- Unit tests (Vitest): detection predicate, cooldown filter, copy builder (surah lookup), gating off.

## Files
New: `src/lib/actions/retention-nudge.ts`, `src/app/api/retention/nudge/route.ts`, `src/lib/actions/retention-nudge.test.ts`, one n8n workflow. No migration, no new table, no new event.

## Dependencies
#538 (push) — consumes `/api/push/send` as-is. #540 — reuses `retention.intervention_triggered`. Producer/consumer split with the existing retention scorer (scorer writes signals 04:00; nudger reads them 06:00).
