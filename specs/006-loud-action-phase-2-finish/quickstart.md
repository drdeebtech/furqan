# Quickstart — Wrapping a New Server Action in `loudAction`

**Audience**: developer (or AI agent) implementing a wrap from this spec's tasks.md.
**Estimated time per action**: 8–15 min for routine wraps; 30+ for PayPal money-path wraps.

## Step 1 — Re-derive from `loud.ts`

Read `src/lib/actions/loud.ts` lines 56–250. Specifically:

- Verify the cause-aware path in the catch block (post-PR-17).
- Confirm `notFoundOrInfra` is exported (post-PR-20).
- Note the `Output` constraint: `void | { message?: string }`.

**Don't copy the wrap shape from a prior PR — derive from the framework.** This is the lesson from Wave-1 + Wave-2 propagation.

## Step 2 — Read the target file

```bash
wc -l <target-file>
grep -n "^export async function\|class UserError" <target-file>
```

Identify:
- Public function names + signatures (must NOT change).
- Existing auth helpers (`requireAdmin`, `requireTeacherOrAbove`, `auth.getUser`).
- Existing `audit_log` writes (preserve as diff rows).
- Existing best-effort patterns (`notify`, `emitEvent`, `Promise.allSettled`).

## Step 3 — Map callers

```bash
grep -rn "<actionName>" src/app src/components --include "*.tsx"
```

Confirm caller signature usage. Common patterns:
- `useActionState(action, initialState)` — preserve `(_prev, formData) => Promise<ActionResult>` shape.
- `action.bind(null, id)` — preserve the bound-arg shape.
- Direct call from a Client Component — preserve the return shape exactly.

## Step 4 — Write the wrap

Per the [wrap-contract](./contracts/wrap-contract.md):

```ts
import { z } from "zod";
import { loudAction, notFoundOrInfra } from "@/lib/actions/loud";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

async function teacherPreflight(): Promise<{ actorId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مسجل الدخول");
  // Optional role check inline — match existing file's auth shape.
  return { actorId: user.id };
}

const fooBase = loudAction<FooInput, { message: string }>({
  name: "domain.action",
  severity: "info", // or "warning" / "critical" per severity-tier rules
  schema: z.object({ /* ... */ }),
  audit: {
    table: "<table>",
    recordId: (i) => i.id,
    action: "UPDATE",
    reasonPrefix: "<actor> <action description>",
  },
  preflight: teacherPreflight,
  handler: async (input, { actorId }) => {
    const supabase = await createClient();

    // .single() with both data and error captured:
    const { data: row, error: rowErr } = await supabase
      .from("<table>").select("*").eq("id", input.id).single();
    if (rowErr || !row) throw notFoundOrInfra(rowErr, "غير موجود");

    // Business-logic check (pure preflight — no cause):
    if (row.status !== "active") throw new UserError("الحالة لا تسمح");

    // Supabase write (cause attached for infra observability):
    const { error } = await supabase.from("<table>").update({ /* ... */ }).eq("id", input.id);
    if (error) throw new UserError("فشل التحديث", { cause: error });

    return { message: "updated" };
  },
});

export async function foo(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const result = await fooBase({ /* decode formData */ });
  if (!result.ok) return { error: result.error };
  return { success: true };
}
```

## Step 5 — Verify

```bash
npx tsc --noEmit --pretty false
git diff --stat
git grep "{ data: \w*\s*}\s*=" <target-file>   # should be empty in handler
grep "throw new UserError" <target-file>        # every infra-wrap has { cause: ... }
grep "severity:" <target-file>                  # justified per action
```

## Step 6 — Update audit doc

Find the action's row in `docs/audit/no-silent-failures-2026-Q2.md` and mark **Wrapped ✅ (PR <N>)** with severity. Same commit as the wrap.

## Step 7 — Commit + push

```bash
git add <target-file> docs/audit/no-silent-failures-2026-Q2.md
git commit -m "chore: wrap <action> in loudAction (per spec 006)"
git push
```

## Deferral path (when wrap doesn't fit)

If the action returns a multi-field object that doesn't fit `Output: { message?: string }`:

1. Don't wrap. Use the [deferral-contract](./contracts/deferral-contract.md) shape: explicit `logError` + manual `audit_log` row.
2. Add a JSDoc comment naming the precedent (e.g. "Same pattern as joinAsObserver, PR 16").
3. Mark **Deferred (PR <N>)** in audit doc with rationale.

## Tripwire test (one-time)

After all wraps land + tripwire grep extends:

1. Add a deliberate `const { data: x } = await supabase.from("...").single()` to a test file.
2. `git commit -m "test"` — should be BLOCKED with the tripwire message.
3. Replace with `const { data: x, error: xErr } = await supabase.from("...").single()`.
4. Commit succeeds. Remove test file before PR.

## When this quickstart isn't enough

Some actions have non-trivial complexity beyond the routine pattern:

- **`addStudentToSession`** (`group-session.ts`) — 4 `.single()` sites, package-credit deduction, Daily.co room resize. Read PR 18's `gradeHomework` (auto-regen branch) for a precedent on multi-side-effect handlers.
- **`captureAndGrantPackage`** (`paypal-actions.ts`) — money double-write. Severity=`critical`. Read Decision 5 in [research.md](./research.md).
- **`updateSessionNotes`** (`teacher/students/[studentId]/actions.ts`) — dual-write to `session_notes_history` + `sessions`. Preserve order strictly.

For these, also read the surrounding PR commits as templates.
