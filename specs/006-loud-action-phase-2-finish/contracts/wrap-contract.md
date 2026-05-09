# Contract — `loudAction` Wrap Shape

**Applies to**: 13 of 15 actions in this spec.
**Reference template**: PRs 7, 9, 11, 12, 13, 14, 15, 18, 19 (any of these is canonical).

## Inputs

```ts
loudAction<TInput, TOutput extends void | { message?: string }>({
  name: string,                   // Stable name for logs/audit/Telegram, e.g. "homework.create-talqeen"
  severity?: "info" | "warning" | "critical",  // Default "info"
  schema?: ZodType<TInput>,       // Zod schema for client-side validation; failures don't trigger Sentry
  audit?: {
    table: string,                 // e.g. "sessions", "bookings"
    recordId: string | ((input: TInput) => string),
    action: "INSERT" | "UPDATE" | "DELETE",
    reasonPrefix?: string,         // e.g. "teacher save post-session notes"
  },
  preflight?: () => Promise<{ actorId: string | null }>,  // Auth check
  handler: (input: TInput, ctx: { actorId: string | null }) => Promise<TOutput>,
})
```

## Public wrapper shape

```ts
const fooBase = loudAction<...>({...});

export async function foo(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const input = decodeFormData(formData);
  const result = await fooBase(input);
  if (!result.ok) return { error: result.error };
  return { success: true /* + any other existing fields */ };
}
```

The public wrapper preserves the existing `(prev, formData) => Promise<ActionResult>` signature so callers don't change.

## Handler responsibilities

Inside the handler:

1. Create supabase client (`createClient()` or `createAdminClient()` per existing convention).
2. For every `.single()` call:
   ```ts
   const { data: x, error: xErr } = await supabase.from(...).single();
   if (xErr || !x) throw notFoundOrInfra(xErr, "<friendly Arabic>");
   ```
   `notFoundOrInfra` is imported from `@/lib/actions/loud`.
3. For business-logic checks (e.g. wrong status, missing field):
   ```ts
   if (hw.status !== "assigned") throw new UserError("حالة المتابعة لا تسمح بهذا الإجراء");
   ```
   No `cause`. Pure preflight = silent passthrough.
4. For Supabase write failures:
   ```ts
   const { error } = await supabase.from(...).update(...);
   if (error) throw new UserError("فشل التحديث", { cause: error });
   ```
   `cause` attached → framework logs to Sentry + Telegram (if critical) + FAILED audit row.
5. Return `{ message: "..." }` on success (or `void`) — must match `TOutput` constraint.

## Severity tier rules

| Action category | Severity |
|---|---|
| Routine writes (P1, P2) | `info` |
| Destructive but expected (delete, status change) | `warning` |
| Money / security / irreversible | `critical` |

## Anti-drift checklist (must paste in PR body)

- [ ] Severity matches blast radius (info / warning / critical)
- [ ] `.single()` calls capture both `data` and `error`; use `notFoundOrInfra`
- [ ] `UserError(msg, { cause })` for infra wraps; plain `UserError(msg)` for preflight/validation
- [ ] `audit_log` columns use `changed_by` (not `actor_id`); no `metadata` field
- [ ] Public signatures unchanged; caller files re-grep'd to confirm
- [ ] Cleanup-on-fail noted for storage / multi-write paths
- [ ] `notFoundOrInfra` imported from `@/lib/actions/loud` (not inlined per-file)

## Test recipe

After wrapping:
1. `npx tsc --noEmit` — passes.
2. `git grep "{ data: \w*\s*}\s*=" <file>` — no Supabase-query sites in handlers.
3. `grep "throw new UserError(.*[eE]rr" <file>` — every match has `{ cause: ... }`.
4. Force a Supabase failure (e.g. RLS denial in preview env) → confirm Sentry event with `cause` within 30 s.
