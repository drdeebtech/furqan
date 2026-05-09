# Contract — Silent-Fail Tripwire Extension

**Applies to**: the pre-commit hook that already catches `?? []` / `?? null` / `.catch(() => {})`.
**This spec extends**: catch the `.single()` error-drop anti-pattern that propagated across PRs 9–16.

## Existing tripwire (do not regress)

| Anti-pattern | Catches |
|---|---|
| `?? []` after Supabase | swallowed array-returning errors |
| `?? null` after Supabase | swallowed single-result errors |
| `.catch(() => {})` | empty rejection handlers |
| Empty `try { ... } catch {}` | swallowed exceptions |

## New rule

**Pattern**: `\{\s*data:\s*\w+\s*\}\s*=\s*await\s+.+\.(single|maybeSingle)\(\)` matched against staged `.ts`/`.tsx` files in `src/`.

**Allowlist** (must NOT trigger):
- Destructures that ALSO capture `error`: `{ data: x, error: xErr } = ...` — the regex requires `}` immediately after the variable, so this doesn't match.
- `auth.getUser()` shape: `{ data: { user } } = await supabase.auth.getUser()` — different shape, doesn't match.
- `getPublicUrl()` shape: storage's `getPublicUrl()` doesn't return an error, so the destructure is safe — different method name, doesn't match.

## Block message

When a match is found:

```
[silent-fail tripwire] BLOCKED: <file>:<line>
Pattern: const { data: <var> } = await ... .single() / .maybeSingle()

The `error` variable is dropped. Infrastructure failures (RLS regression,
network blip, Postgres restart) will surface as "row not found" to the user
without reaching Sentry — the exact anti-pattern fixed in PRs 18–20.

Fix: capture both `data` and `error`:
    const { data: <var>, error: <var>Err } = await ... .single();
    if (<var>Err || !<var>) throw notFoundOrInfra(<var>Err, "<friendly>");

Import `notFoundOrInfra` from `@/lib/actions/loud`.
See: PR #266 review for the precedent that motivated this tripwire.
```

## Implementation location

`.husky/pre-commit` (or whichever script the hook executes — repo currently uses Husky).

The grep extension runs after the existing tripwire greps. If any match is found, exit non-zero with the block message.

## Test recipe

1. Add a deliberate `const { data: x } = await supabase.from("...").single()` to a test file (no `error` capture).
2. `git add` + `git commit -m "test"`.
3. Confirm the hook blocks with the message above and exits non-zero.
4. Replace with `const { data: x, error: xErr } = await supabase.from("...").single()`.
5. `git commit` succeeds.

## Performance

The grep is shell-native and runs against staged files only. Sub-second on a 100-file diff. Negligible vs the existing pre-commit greps.
