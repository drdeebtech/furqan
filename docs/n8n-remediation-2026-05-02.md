# n8n Workflow Remediation — 2026-05-02

Generated from the full 33-workflow audit. Apply in n8n UI at https://n8n.drdeeb.tech.
Each fix lists: workflow name, node name, exact change, and verification step.

---

## RESOLUTION 2026-05-02 — P0-1 closed (read first)

**Status: P0-1 fully resolved.** Webhook secret rotation completed and consolidated onto a single shared n8n credential.

**What shipped this session:**

- ✅ **Re-rotated `N8N_WEBHOOK_SECRET`** in Vercel production env. The previous rotation had set the env var as Sensitive, which made the value unreadable from `vercel env pull` and the dashboard alike — forcing a controlled re-rotation. New value lives in: Vercel env (Production) + the n8n credential below. No copies in workflow JSON or on disk.
- ✅ **Created centralized n8n credential `furqan-n8n-webhook-secret`** (Header Auth, header `X-N8N-Secret`). Credential ID `uzWkE168wRbRr0iJ` in project `YUToCIYZx9HubZ2M`. **This is now the operator standard for any workflow that callbacks to `/api/webhooks/n8n` or `/api/cron/*`.**
- ✅ **`furqan-retention-scorer`** migrated off the inline `X-N8N-Secret` header onto the credential. Production execute returned `200 OK` with `{ok:true, scored:506, high_risk:503}`. Workflow `yJfMjUEbQOwWpMZH`, executions 18008 (success) verifying.
- ✅ **`furqan-bunny-stuck-lessons`** migrated off its standalone "Header Auth account" credential onto the same shared credential. Production execute returned `200 OK` with `{ok:true, scanned:0, updated:0}`. Workflow `oSgC94xMLDGUYu8s`, execution 18018 verifying.
- ✅ **Orphan credential `lEyrqeelVH4zRrWb` ("Header Auth account") deleted** — was holding the previous-rotation value (a quiet credential leak). No remaining references.
- ✅ **`furqan-telegram-admin-bot` unpublished** — last session's accidental Publish (the activation gotcha below) reverted. `active: false`, `activeVersionId: null`. Confirmed via MCP.

**Operator standard going forward:**

> Any new n8n workflow that callbacks `/api/webhooks/n8n` or `/api/cron/*` MUST use the `furqan-n8n-webhook-secret` credential. NEVER inline the X-N8N-Secret header value in `headerParameters`. Future rotations are then a single credential edit instead of N workflow edits.

**Activation gotcha (re-stated, surfaced last session):**

> Publishing an inactive n8n workflow activates it. n8n's Publish button does two things — version checkpoint AND flip-active-on — with no opt-out. If you want to keep a workflow inactive after a fix, immediately use the version dropdown next to the green Published button → **Unpublish** to revert. (n8n MCP exposes `unpublish_workflow` for this.)

**Bonus correction to the original P0-2 spec below:**

> The "Supabase service-role JWT" in `furqan-workflow-failure-sentinel` is actually an **n8n public-API JWT** (header `X-N8N-API-KEY`, used to query `localhost:5678/api/v1/executions`). The remediation steps still apply — rotate the JWT and replace inline with a credential — but the rotation flow is the n8n Settings → API page, not Supabase Dashboard.

**Still open after this session:**

- ❗ **P0-2** — `furqan-workflow-failure-sentinel` n8n API JWT hardcoded inline. Operator-only, separate task.
- ❗ Several inactive workflows still inactive on purpose (`furqan-weekly-teacher-performance`, etc.) — left as-is.
- ❗ The `furqan-announcement-broadcaster` and `furqan-message-content-moderation` webhook receivers do NOT verify any incoming X-N8N-Secret on their public webhook triggers. Anyone with the webhook URL could trigger them. Worth treating as a P3 cleanup — add a credential check on the webhook node.

---

## STATE AT END OF SESSION 2026-05-02 (read first)

**Done (Chrome-driven, verified Published green dot in n8n):**
- ✅ P1-1 `furqan-audit-log-enrichment` — `'success'` → `'succeeded'` published
- ✅ P1-2 `furqan-announcement-broadcaster` — `'success'` → `'succeeded'` published
- ✅ P1-3 `furqan-message-content-moderation` — `'flagged'`/`'clean'` → `'succeeded'` + `outcome` moved into `result_json` (both Log Result Flagged and Log Result Clean nodes)
- ✅ P1-4 `furqan-telegram-admin-bot` — `'success'` → `'succeeded'` published **but workflow was inadvertently activated by the publish**; n8n API confirms `active: true` while reporting "no production triggers" so it is functionally inert. Decide: leave active (no-op) or open the workflow → `▼` next to Published → Unpublish to restore prior inactive state.
- ✅ P2-1 `furqan-platform-health-check` — `Check App` URL changed from `https://furqan.today` to `https://www.furqan.today` published

**Blocked on user input (cannot proceed without):**
- 🔴 **P0-1 `furqan-retention-scorer`** — has the OLD `N8N_WEBHOOK_SECRET` (`a34c4d34…ce6de`) hardcoded inline in the `POST retention-score` node's `Header Parameters` row named `X-N8N-Secret`. Cron runs are 401'ing in production right now. **Need**: current value of `N8N_WEBHOOK_SECRET` from Vercel env (`npx vercel env pull .env.local && grep N8N_WEBHOOK_SECRET .env.local`). Then convert that node to use a centralized n8n Header Auth credential called `furqan-n8n-webhook-secret`, OR (quick) replace the hardcoded value inline. Approach detail below in P0-1 section.
- 🔴 **P0-2 `furqan-workflow-failure-sentinel`** — has a Supabase service-role JWT hardcoded in a Code node. Needs JWT rotated in Supabase dashboard first (alforqan.egy@gmail.com), then `SUPABASE_SERVICE_ROLE_KEY` updated in Vercel env, then app redeployed, then the workflow's inline JWT replaced with a credential reference. Operator-only because it requires Supabase dashboard access on the right account.

**Sweep result (read-only MCP discovery):**
- Searched all 36 furqan workflows. Only `furqan-retention-scorer` has `X-N8N-Secret` hardcoded. `furqan-bunny-stuck-lessons` already uses an HTTP Header Auth credential properly (so its credential value also needs to be updated to the new secret OR confirmed up-to-date).

**Important gotcha learned this session:**
- **Publishing an inactive n8n workflow activates it.** n8n's "Publish" button does two things: it creates a new version checkpoint AND it flips the workflow's active state on. There is no way to publish-but-stay-inactive. If you publish an inactive workflow and want to keep it inactive, immediately use the dropdown next to the Published button → Unpublish to revert. This is what happened with `furqan-telegram-admin-bot` above.

**Brief for next session (paste this verbatim):**

> Continue the n8n webhook secret rotation per the plan at `/Users/drdeeb/.claude/plans/recorded-courses-courses-are-linked-hammock.md` and the remediation doc at `docs/n8n-remediation-2026-05-02.md`. Status: P1-1, P1-2, P1-3, P1-4, P2-1 are all published. P0-1 `furqan-retention-scorer` is broken in prod because of an old hardcoded `N8N_WEBHOOK_SECRET`. I will paste the current value next; convert the `POST retention-score` HTTP Request node to use a centralized n8n Header Auth credential named `furqan-n8n-webhook-secret` (preferred over inline replacement), then publish, then test-execute the workflow once and confirm a `status='succeeded'` row appears in `automation_logs`. Also verify the credential `furqan-bunny-stuck-lessons` already uses points to the new secret value. Do NOT touch P0-2 (Supabase JWT rotation) — that's a separate operator task. Decide what to do about `furqan-telegram-admin-bot` being inadvertently active (currently functionally inert per n8n API "no production triggers" — leaving as-is is safe).

---

## P0-1 (URGENT) — `furqan-retention-scorer`

**Why urgent:** the workflow had the OLD `N8N_WEBHOOK_SECRET` value hardcoded as
an HTTP header. We rotated that secret earlier today, so every cron run now
returns 401 from `/api/webhooks/n8n` and the retention scorer is silently dead.

**Steps:**

1. Open https://n8n.drdeeb.tech → workflow `furqan-retention-scorer` (ID `yJfMjUEbQOwWpMZH`)
2. Find the HTTP Request node that POSTs to `https://www.furqan.today/api/webhooks/n8n`
   (or `https://furqan.today/api/webhooks/n8n` — see P2-1 below if it's still apex)
3. In `Header Parameters`, locate the row with name `X-N8N-Secret` and a
   long-looking inline value
4. **Better fix (recommended):** delete that row. Switch `Authentication` to
   `Generic Credential Type → Header Auth`. Click `Create New` and create a
   credential called `furqan-n8n-webhook-secret` with:
   - Name: `X-N8N-Secret`
   - Value: (the current value of `N8N_WEBHOOK_SECRET` from `npx vercel env pull`)
   - Save
5. **Quick fix (if you don't want to migrate now):** update the inline value
   to match the current `N8N_WEBHOOK_SECRET` from Vercel env
6. **Verify:** trigger the workflow manually. Check `automation_logs` table —
   you should see a fresh row with `workflow_name='furqan-retention-scorer'`
   and `status='succeeded'` within ~30s

---

## P0-2 — `furqan-workflow-failure-sentinel`

**Why important:** Code node contains a hardcoded Supabase service-role JWT
inline. Service-role JWTs are unrotatable secrets that grant full DB bypass —
they should never live in code.

**Steps:**

1. Open Supabase dashboard (alforqan.egy@gmail.com) → Project Settings →
   API → roll the `service_role` JWT
   - **Coordinate first:** anything else using the old JWT (server actions,
     other workflows) will break the moment you click Roll. Search the
     codebase for `SUPABASE_SERVICE_ROLE_KEY` references and confirm they
     all read from env (they do — `src/lib/supabase/admin.ts:8`)
   - Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel env (all 3 environments)
   - Redeploy production
2. Open n8n workflow `furqan-workflow-failure-sentinel` (ID `9fCxICrhtSNgFmYt`)
3. Find the Code node containing the literal string starting with
   `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (it'll be in a `headers` or
   `Authorization` declaration)
4. Replace the inline JWT with an HTTP Header Auth credential:
   - Switch the relevant HTTP call from "Generic" to "Predefined" with the
     `supabaseApi` credential type, OR
   - Use the existing `supabaseApi` credential the rest of the workflows use
5. **Verify:** trigger the workflow manually. It should still write to
   `automation_logs` (using the credential), but the JWT is no longer in code.

---

## P1-1 — `furqan-audit-log-enrichment` (enum violation)

**Why:** `automation_logs.status` has a CHECK constraint allowing only
`started | succeeded | failed | skipped`. The node writes `'success'`, so
every log insert silently fails.

**Steps:**

1. Open workflow `furqan-audit-log-enrichment` (ID `cdb2iKW0dlNFWZm8`)
2. Open the **Log Result** node (HTTP Request, posts to `/automation_logs`)
3. In the JSON body field, find this fragment:
   ```
   status: 'success',
   ```
   Change to:
   ```
   status: 'succeeded',
   ```
4. Save and re-activate
5. **Verify:** wait 30 minutes (cron runs every 30 min). Run:
   ```sql
   select count(*) from automation_logs
   where workflow_name = 'furqan-audit-log-enrichment'
     and started_at > now() - interval '1 hour';
   ```
   Should return at least 1 row (was 0 before).

---

## P1-2 — `furqan-announcement-broadcaster` (enum violation)

**Steps:**

1. Open workflow `furqan-announcement-broadcaster` (ID `HpCTrDfCFqE0wziT`)
2. Open the **Log Result** node
3. In the JSON body, find:
   ```
   status: 'success',
   ```
   Change to:
   ```
   status: 'succeeded',
   ```
4. Save and re-activate
5. **Verify:** trigger the workflow with a test payload (e.g. `curl -X POST
   https://n8n.drdeeb.tech/webhook/furqan-announcement -H "content-type:
   application/json" -d '{"title":"test","body":"verify-fix","target_role":
   "admin"}'`). Confirm a row appears in `automation_logs` with
   `event_name='announcement_sent'` and `status='succeeded'`.

---

## P1-3 — `furqan-message-content-moderation` (enum violation, two nodes)

**Why:** writes `status: 'flagged'` and `status: 'clean'` — neither is in
the enum. Both branches silently fail their log inserts.

**Steps:**

1. Open workflow `furqan-message-content-moderation` (ID `lqdQg2BvGTUpHJjF`)
2. **Log Result Flagged** node — in the JSON body:
   - Find: `status: 'flagged'`
   - Change to: `status: 'succeeded'`
   - Find: `result_json: JSON.stringify({ flaggedWords: ... })`
   - Change to: `result_json: JSON.stringify({ outcome: 'flagged', flaggedWords: ... })`
3. **Log Result Clean** node — in the JSON body:
   - Find: `status: 'clean'`
   - Change to: `status: 'succeeded'`
   - Find: `result_json: '{}'`
   - Change to: `result_json: JSON.stringify({ outcome: 'clean' })`
4. Save and re-activate
5. **Verify:** trigger the message webhook. Confirm both branches
   (flagged + clean) write `succeeded` rows with `outcome` in the result.

---

## P1-4 — `furqan-telegram-admin-bot` (enum violation, INACTIVE)

Same `status: 'success'` bug, but the workflow is currently inactive so it's
not running. Apply the same fix as P1-1 before re-activating.

**Decision needed:** is this workflow inactive on purpose, or stalled? If
intentional, leave it. If you want it back on, apply the fix first.

---

## P2-1 — `furqan-platform-health-check` (apex URL)

**Why:** `Check App` node fetches `https://furqan.today` which Vercel 307s
to `https://www.furqan.today`. The HTTP Request node already has
`followRedirects: true`, so the check passes — but it's an extra hop and
masks any apex-only outage that doesn't redirect.

**Steps:**

1. Open workflow `furqan-platform-health-check` (ID `dldJFeIfXwvIUqyW`)
2. Open the **Check App** node
3. URL field: change `https://furqan.today` → `https://www.furqan.today`
4. Save and re-activate
5. **Verify:** wait 5 minutes (cron runs every 5 min). The Telegram alert
   should not fire (assuming the site is up).

---

## P3 cleanup (optional, low priority)

- **`furqan-low-package-balance-alert`**: a `noOp` node was left in after a
  refactor. Open the workflow, find the disconnected `No Operation` node,
  delete it. Cosmetic only.
- **`furqan-telegram-admin-bot` (inactive)** + **`furqan-weekly-teacher-performance` (inactive)**:
  Confirm intent. If they should run, re-activate them (apply P1-4 fix to
  the bot first). If they're deliberately off, archive them so the inactive
  list isn't confusing.

---

## Verification at the end

After all P0/P1 fixes, run this SQL in Supabase to confirm no rows are
silently failing the CHECK:

```sql
select workflow_name, status, count(*)
from automation_logs
where started_at > now() - interval '24 hours'
group by workflow_name, status
order by workflow_name, status;
```

Every status value in the result must be in `started | succeeded | failed | skipped`.
If you see anything else, you missed a node.

---

## Rollback note

For each n8n workflow change, n8n stores the previous `versionId`. If a fix
breaks something, open the workflow → click the version-history icon → revert
to the prior `versionId`. The IDs at time of audit are listed in the
"Why" section of each fix above for traceability.
