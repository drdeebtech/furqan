# Contract — Deferral ("Loud-by-Hand") Shape

**Applies to**: actions whose return shape doesn't fit `loudAction`'s `Output: { message?: string }` constraint.
**This spec defers**: `generateSessionToken` (returns `{ token, roomUrl }`), `initiateEnrollmentCheckout` (Stripe-deferred — separate concern).
**Reference templates**: PR 16 (`joinAsObserver`), PR 18 (`getHomeworkAudioUrl`), PR 19 (`bulkGradeHomework`).

## When to use

- Action returns a multi-field object (e.g. `{ token, roomUrl }`, `{ url }`, `{ graded, failed, errors[] }`)
- Restructuring the caller is out of scope
- A future framework PR may extend `Output` to support typed payloads (deferred Phase 3 candidate)

## Required structure

```ts
/**
 * <action> returns `{ ... }` — multi-field payload that doesn't fit
 * loudAction's Output: { message?: string } constraint, so the wrap is
 * **deferred** here. Same pattern as joinAsObserver (PR 16). Kept
 * loud-by-hand with explicit logError + manual audit_log row added.
 */
export async function action(input): Promise<ReturnShape> {
  // 1. Auth check — explicit, returns user-facing error on denial.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  // 2. Business logic — preserve existing flow verbatim.
  // ...

  // 3. Every Supabase write with an error path explicitly logs + returns.
  const { error } = await supabase.from(...).update(...);
  if (error) {
    logError("<actionName>: <step> failed", error, {
      tag: "<domain>",
      metadata: { /* identifying fields */ },
    });
    return { error: "<friendly Arabic>" };
  }

  // 4. Manual audit_log row — added in this spec (was previously missing).
  // Best-effort: a failed audit insert must not fail the action itself.
  await createAdminClient()
    .from("audit_log")
    .insert({
      changed_by: actorId,
      table_name: "<table>",
      record_id: "<id>",
      action: "<INSERT|UPDATE|DELETE>",
      old_data: null,
      new_data: { /* relevant snapshot */ },
      reason: "<deferred-action> via loud-by-hand",
    })
    .then((r) => {
      if (r.error) logError("<actionName>: audit row failed", r.error, { tag: "<domain>" });
    });

  return { /* multi-field return */ };
}
```

## Documentation requirement

Every deferred action MUST have a top-of-function JSDoc comment naming:
- The exact return-shape mismatch with `loudAction`'s `Output` constraint.
- The reference precedent (e.g. "Same pattern as joinAsObserver (PR 16)").
- Whether a future framework PR is the path forward.

## Audit doc requirement

Every deferred action gets a row in `docs/audit/no-silent-failures-2026-Q2.md` marked **Deferred (PR <N>)** with the rationale and follow-up note.

## Test recipe

After deferring:
1. `grep "logError" <file>` — confirms every error path logs.
2. `grep "audit_log" <file>` — confirms manual audit row is added (was previously missing).
3. Force a failure path → confirm Sentry event arrives within 30 s (via the explicit `logError`, NOT via framework cause-handling).
