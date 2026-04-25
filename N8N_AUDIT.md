# n8n + Automation Audit — Senior Review · 2026-04-25

Audit of the app↔n8n surface: emit pipeline, webhook callback, REST client, admin control panel, and documentation drift between `BLUEPRINT.md` / `EVENT_CATALOG.md` / actual code. Three parallel exploration agents ran, plus a live n8n API ping. Findings filtered through senior triage.

## Methodology + verification

- **Lens A** — `emit.ts`, webhook callback, `emitEvent` callsite coverage
- **Lens B** — n8n REST client, admin control panel UI
- **Lens C** — documentation drift (BLUEPRINT vs EVENT_CATALOG vs reality)
- **Live ping** — `curl https://n8n.drdeeb.tech/api/v1/workflows` returned **connection refused (port 443)**. Either the Mac mini is offline or the public hostname doesn't resolve from this host. **This is itself a P0 operational signal.**

**False positives caught and dropped:**
- Lens C claimed `emitEvent("booking.confirmed")` is absent from the codebase. Verified false — exists at `teacher/dashboard/actions.ts:140` and `admin/bookings/actions.ts:57` (the latter added earlier this session in commit `a69dad3`).
- Lens C claimed booking.created and session.ended have no WEBHOOK_ROUTES. Strictly true but not a defect — they fall through to `DEFAULT_WEBHOOK_PATH` `/webhook/furqan-events` by design (per emit.ts line 26 comment).
- Lens A claimed `homework.edited` and `homework.deleted` should exist. Strictly correct, but neither catalog event is documented; not pre-existing gaps.

## emitEvent callsite coverage (verified via grep)

| Catalog event | Emitter | Status |
|---|---|---|
| `booking.created` | `student/bookings/new/actions.ts:243` | ✅ |
| `booking.confirmed` | `teacher/dashboard/actions.ts:140`, `admin/bookings/actions.ts:57` | ✅ but see #1 below |
| `booking.cancelled` | — | ❌ **Real gap** |
| `session.ended` | `teacher/dashboard/actions.ts:268` | ✅ |
| `session.no_show` | `teacher/dashboard/actions.ts:189` | ✅ |
| `session.notes_saved` | `teacher/sessions/[id]/actions.ts:29` | ✅ |
| `homework.assigned` | `lib/actions/homework.ts:98` | ✅ |
| `homework.student_ready` | `lib/actions/homework.ts:138` | ✅ |
| `homework.graded` | `lib/actions/homework.ts:231` | ✅ |
| `evaluation.created` | `lib/actions/evaluations.ts:59,108` | ✅ |
| (uncatalogued) `retention.intervention_logged`? | `admin/retention/actions.ts:103` | ⚠️ Drift |
| (uncatalogued) parent-report event | `lib/reports/send-narrative.ts:150` | ⚠️ Drift |

## Findings

| # | Sev | Lens | File:Line | Finding | Fix |
|---|-----|------|-----------|---------|-----|
| 1 | **P0** | A | `src/app/teacher/dashboard/actions.ts:140` | `emitEvent("booking.confirmed")` fires AFTER the if/else block — when teacher CANCELS (status === "cancelled"), it still emits "booking.confirmed". n8n workflows for booking.confirmed get triggered for cancellations. **Production data-integrity bug.** | Move emit inside the `if (status === "confirmed")` branch; add a separate `emitEvent("booking.cancelled", …)` inside the `else if` branch. |
| 2 | **P0** | Live | `n8n.drdeeb.tech:443` | Connection refused at audit time. Either the Mac mini is offline, the public hostname doesn't resolve, or Cloudflare/firewall is blocking. The control panel will show errors; events fire-and-forget will silently drop. | Verify Mac mini is up; if hostname isn't routing, document the network path; add a watchdog that posts to Telegram if n8n is unreachable for >5 min. |
| 3 | **P1** | Coverage | (no file) | `booking.cancelled` event has no emitter despite being in EVENT_CATALOG.md as active. Customers cancelling bookings → no n8n notification flow runs. | Add `emitEvent("booking.cancelled", …)` to `student/bookings/[id]/cancel` (or wherever cancellations originate) AND `admin/bookings/actions.ts` cancellation path. |
| 4 | **P1** | A | `src/lib/automation/emit.ts:39-86` | Failed emit doesn't write to `automation_dead_letter` — it only logs to `automation_logs` with status="failed". DLQ table exists but isn't populated. Manual replay path can't replay failed events because they're not in DLQ. | After 3 retries (or fetch failure), insert row into `automation_dead_letter` with payload + last error. Wire `/admin/automation/replay` to read both. |
| 5 | **P1** | A | `src/lib/automation/emit.ts` | No retry policy at all — single fetch, on failure log and return. Transient n8n outages or 503s drop events permanently. | Add 1-2 retry attempts with exponential backoff (250ms, 1s) before declaring dead-lettered. |
| 6 | **P1** | A | `src/lib/automation/emit.ts` | No AbortController timeout on fetch — if n8n hangs, the calling server action hangs the request. | `const controller = new AbortController(); setTimeout(() => controller.abort(), 5000)`; pass `signal` to fetch. |
| 7 | **P1** | A | `src/app/api/webhooks/n8n/route.ts` | Webhook callback "log" action ignores Supabase insert errors. n8n thinks the call succeeded; we have no log row. | Destructure `{ error }` and return `{ status: 500 }` on failure so n8n retries. |
| 8 | **P1** | A | `src/app/api/webhooks/n8n/route.ts` | "notify" action does notification insert + delivery_log insert without a transaction. Partial success leaves inconsistent state. | Wrap in a Postgres function (RPC) that does both inside a single transaction, or accept idempotent re-delivery. |
| 9 | **P1** | A | `src/app/api/webhooks/n8n/route.ts` | No body-size cap before `request.json()` — a 100MB POST could be parsed. | Check `content-length`; reject `>1MB` with 413. |
| 10 | **P1** | B | `src/app/admin/n8n/components/overview-tab.tsx:171` | "Auto-restart" executes without confirmation. One stray click can restart a critical workflow mid-execution. | Add a confirm dialog showing workflow name + last execution status. |
| 11 | **P1** | B | `src/app/api/n8n/auto-restart/route.ts` | Restart sequence is `deactivate → 500ms → activate` hardcoded — no jitter; on multi-failure storm, all admin clients converge restart attempts. | Add jitter (`500 + Math.random()*500`); log the restart attempt with workflow id BEFORE issuing it (so loop detection sees it). |
| 12 | **P1** | B | `src/lib/n8n/actions.ts` + `src/app/api/n8n/auto-restart/route.ts` | Auto-restart logic duplicated. Future change has to touch 2 places. | Extract to `src/lib/n8n/auto-restart.ts`; import from both. |
| 13 | **P1** | B | `src/lib/n8n/client.ts:124-134` | `sendTelegramAlert()` has no timeout. Telegram API hangs → admin operations hang. | AbortController 5s timeout; alert failure must be best-effort, never blocking. |
| 14 | **P1** | B | `src/app/api/n8n/auto-restart/route.ts` | Header check verifies presence of `X-N8N-Secret` but doesn't compare to env. | `timingSafeEqual(headerBuf, expectedBuf)` (match the pattern already used in `webhooks/n8n/route.ts`). |
| 15 | P2 | A | `src/lib/automation/emit.ts` | `trace_id = crypto.randomUUID()` — random. Stored only in failed-emit logs, not success logs. Can't trace successful events end-to-end. | Always insert `automation_logs` row with `trace_id` (status: "succeeded"|"failed"); keep ID stable for the request. |
| 16 | P2 | A | `src/app/api/webhooks/n8n/route.ts` | Idempotency check filters `status="succeeded"` only. In-flight or pending rows not seen → dup events possible during retry windows. | Drop the status filter; check by `idempotency_key` regardless of status. |
| 17 | P2 | A | `src/app/api/webhooks/n8n/route.ts` | Failed auth attempts not logged. Brute-force on the webhook leaves no audit trail. | Log failed-auth events (with IP from `X-Forwarded-For`) to `automation_logs` with status="auth_failed". |
| 18 | P2 | B | `src/app/admin/n8n/components/n8n-tabs.tsx:45` | Polling continues every 10s even when tab not visible. Wastes CPU + n8n API quota. | Pause interval on `document.visibilityState !== "visible"`. |
| 19 | P2 | B | `src/app/admin/n8n/components/overview-tab.tsx:358` | Search input not debounced — re-filters on every keystroke for potentially 100+ workflows. | Debounce 300ms via `useMemo` + small util. |
| 20 | P2 | B | `src/lib/n8n/client.ts:14` | Timeout hardcoded 15s globally. Different endpoints have different latency profiles. | `N8N_TIMEOUT_MS` env var with 15s default; allow per-call override. |
| 21 | P2 | B | `src/lib/n8n/client.ts:32` | `JSON.parse()` not wrapped — malformed n8n response throws SyntaxError that callers don't catch. | `try { JSON.parse(text) } catch { throw new Error("Invalid JSON from n8n: " + text.slice(0,200)) }`. |
| 22 | P2 | B | `src/app/admin/n8n/components/health-audit-tab.tsx:71` | Audit POST has no AbortController — can hang indefinitely. | 60s timeout with user-visible warning. |
| 23 | P2 | C | `automation/BLUEPRINT.md` vs `CLAUDE.md` | BLUEPRINT documents 52 planned workflows; CLAUDE says 44+ active. The 8-workflow gap isn't enumerated anywhere. | One-line per BLUEPRINT entry: "Status: ACTIVE | PLANNED | DEFERRED". |
| 24 | P2 | C | `automation/VPS_HANDOFF.md`, `automation/VPS_ANSWERS.md` | Documents reference VPS setup; n8n moved to Mac mini. New agent reading these gets misled. | Add a banner at the top of each: "DEPRECATED — see CLAUDE.md for current Mac-mini deployment." |
| 25 | P2 | C | `EVENT_CATALOG.md` vs grep | Two emitters fire events not in the catalog: `retention/actions.ts:103` and `reports/send-narrative.ts:150`. | Add the two events to EVENT_CATALOG.md "active" section with their data shape. |
| 26 | P2 | C | `supabase/functions/` (4 edge functions) | `auto-reminder`, `auto-complete`, `no-show-detector`, `weekly-report` exist but aren't in BLUEPRINT or AUTOMATION_REGISTRY. Are they superseded by n8n or active? | Triage each: if superseded, delete; if active, register them in BLUEPRINT under "Edge functions (Supabase-native)". |
| 27 | P2 | C | `COMMUNICATION_TEMPLATES.md` | 30+ templates listed but no "Triggered By" column linking each to an event/workflow. | Add column; cross-link to BLUEPRINT WF-IDs. |
| 28 | P3 | A | `src/lib/automation/emit.ts:6` | Doc comment shows `try { await emitEvent(...) } catch {}` pattern — used inconsistently across callsites (some have catch, some `.catch(() => {})`, some bare await). | Standardize on one pattern; document in CLAUDE.md. |
| 29 | P3 | B | `src/app/admin/n8n/...` | Workflow names are raw n8n internal ("furqan-booking-confirmed") — not user-friendly in UI. | Add display-name mapping or use the workflow's `tags` field. |
| 30 | P3 | B | `src/app/admin/n8n/components/admin-log-tab.tsx:33` | Hardcoded 50-row limit; older actions invisible. | Cursor pagination or "Load more". |
| 31 | P3 | C | `EXCEPTION_PLAYBOOKS.md` | PB-05 (n8n workflow in failure loop) assumes admin reads `automation_logs` + `automation_dead_letter` but those aren't introduced earlier in the doc. | Add an "Observability tables" preamble. |

## Triage summary

| Sev | Count | Disposition |
|-----|------:|-------------|
| P0 | 2 | **Fix immediately** — cancellation emit bug + n8n offline (operational) |
| P1 | 12 | High-leverage fix wave |
| P2 | 13 | Bundle into a follow-up session |
| P3 | 4 | Defer to ROADMAP |

## Highest-ROI fixes (recommended next session)

1. **#1 — `booking.confirmed` emit on cancellation.** 5-line fix; eliminates a real production data bug. Move emit inside the `if/else if` branches with the correct event name per branch.
2. **#3 — `booking.cancelled` emitter.** Add the missing emitter so the catalog matches reality.
3. **#5, #6 — retry + timeout in `emit.ts`.** AbortController + 1-retry. ~15 lines. Hardens every event.
4. **#4 — DLQ population on failure.** Wires the existing dead-letter table into the emit path so the existing `/admin/automation/replay` UI actually has rows to replay.
5. **#11, #14 — auto-restart hardening.** Jitter + timing-safe secret check.

## Observability gap (cross-cutting)

The biggest theme across waves: **events fire, sometimes succeed, sometimes silently fail, and the success path leaves no trace**. Adding a single `automation_logs` insert on every emit attempt (status: "started"|"succeeded"|"failed", with `trace_id`) would make the entire automation surface observable end-to-end with no n8n-side changes. Single highest-leverage observability win.

## Out of scope

- Workflows themselves (the n8n JSON definitions on the Mac mini) — can't audit while host is unreachable.
- Stripe / Anthropic / WhatsApp integrations — externally blocked.
