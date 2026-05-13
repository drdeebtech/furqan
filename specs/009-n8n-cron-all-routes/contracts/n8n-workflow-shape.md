# Contract: n8n Cron-Firing Workflow Shape

Every n8n workflow that calls a Next.js cron route MUST conform to this shape. Deviation breaks FR-003, FR-005, FR-006, FR-007, FR-008.

## Workflow JSON skeleton

```json
{
  "name": "furqan-cron-<route-name>",
  "active": true,
  "nodes": [
    {
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "parameters": {
        "rule": {
          "interval": [{ "field": "cronExpression", "value": "<MUST MATCH withCronMonitor() in route.ts>" }]
        }
      }
    },
    {
      "name": "Call Route",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "https://www.furqan.today/api/cron/<route-name>",
        "method": "GET",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "=Bearer {{$env.CRON_SECRET}}" },
            { "name": "X-N8N-Secret", "value": "={{$env.N8N_WEBHOOK_SECRET}}" }
          ]
        },
        "options": {
          "response": { "response": { "responseFormat": "json" } }
        }
      },
      "continueOnFail": true,
      "alwaysOutputData": true
    },
    {
      "name": "Log Run",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "{{$env.SUPABASE_URL}}/rest/v1/automation_logs",
        "method": "POST",
        "credentials": { "supabaseApi": { "id": "<CRED.SUPABASE_FURQAN>" } },
        "bodyParameters": {
          "parameters": [
            { "name": "workflow_name", "value": "cron-<route-name>" },
            { "name": "event_name", "value": "trigger.fired" },
            { "name": "status", "value": "succeeded" },
            { "name": "started_at", "value": "={{$now}}" },
            { "name": "finished_at", "value": "={{$now}}" }
          ]
        }
      },
      "continueOnFail": true,
      "alwaysOutputData": true
    }
  ],
  "connections": {
    "Schedule Trigger": {
      "main": [
        [
          { "node": "Call Route", "type": "main", "index": 0 },
          { "node": "Log Run", "type": "main", "index": 0 }
        ]
      ]
    }
  }
}
```

## Required attributes

| Attribute | Required value | FR ref |
|-----------|---------------|--------|
| `nodes[].type=n8n-nodes-base.scheduleTrigger` | exactly 1 | FR-003 |
| Schedule trigger's `cronExpression` value | byte-for-byte match with `withCronMonitor()` arg #2 in route file | FR-004 |
| HTTP node calling app route | has both `Authorization: Bearer ${CRON_SECRET}` AND `X-N8N-Secret: ${N8N_WEBHOOK_SECRET}` headers | FR-005 |
| Every HTTP node | `continueOnFail: true` (= `onError: "continueRegularOutput"` in older schema) | FR-007 |
| Every HTTP node | `alwaysOutputData: true` | FR-007 |
| `Log Run` node | hangs off the trigger **in parallel** with `Call Route` (not after) | FR-006 |
| `Log Run` node | posts to `automation_logs` with the 5 required fields | FR-006 |
| Credentials | bound by `id` via `CRED` constant in `scripts/n8n-harden/lib.mjs` | FR-008 |

## Forbidden patterns

| Anti-pattern | Why forbidden | FR ref |
|--------------|---------------|--------|
| Hardcoded API keys / secrets in JSON | Workflow JSON committed to repo or imported via MCP leaks secrets | FR-019 |
| Credential bound by name only | n8n stores binding by ID; name-only binding silently fails | FR-008 |
| `Log Run` node **after** `Call Route` | If `Call Route` fails, `Log Run` doesn't fire; presence-detection is lost | FR-006 |
| Single-auth (just `X-N8N-Secret` or just `Bearer`) | Routes require dual-auth; operator manual invocation needs `Bearer`, n8n needs `X-N8N-Secret` | FR-005 |
| Renaming a workflow without deprecation | `automation_logs.workflow_name` history becomes orphaned | FR-012 |

## Validation

Pre-import:
```bash
# MCP schema validation OK for design
mcp__claude_ai_n8n__validate_workflow <workflow-json>
```

Post-import (operator):
```bash
node scripts/n8n-harden/run.mjs <workflowId> <slug>   # re-bind credentials by ID
node scripts/n8n-audit.mjs                            # confirm appears in registered+live
```

Post-first-fire (operator):
```sql
SELECT * FROM automation_logs
WHERE workflow_name = 'cron-<route-name>'
ORDER BY started_at DESC LIMIT 1;
```
Expect one row with `status='succeeded'` within the schedule interval.
