# Contract: `deletePackage()`

**File**: `src/app/admin/packages/actions.ts:89`
**Caller role**: `admin` (enforced at route adapter)
**State transition**: hard-delete from `packages` (the catalog), NOT from `student_packages` (per-student rows)
**`loudAction` wrap**: ❌ Not yet (D-001)

## Input

```ts
type DeletePackageInput = (packageId: string);
```

## Output

```ts
type Result = { success: true } | { success: false; error: string };
```

## Pre-conditions checked

| Check | Where | FR |
|---|---|---|
| Caller is admin | Route adapter | FR-009 |
| Package row exists | TS / DB FK | FR-009 |
| No `student_packages` reference this package OR the FK has CASCADE/SET NULL | DB FK ON DELETE policy (verify in T10 of tasks.md) | FR-009 |

## Side effects

- DELETE from `packages`.
- If FK ON DELETE is RESTRICT (most likely default): returns FK error if any `student_packages` row references this package — students who already purchased keep their subscription, but the catalog entry can't be removed. Operator must "deactivate" via `togglePackageActive` instead.
- `revalidatePath('/admin/packages')` and `'/(public)/packages')`.
- No audit_log today.

## Important: catalog vs subscription distinction

`deletePackage()` operates on the **catalog** (`packages` table). It does NOT affect existing **per-student subscriptions** (`student_packages` rows). A student who purchased "pack_8" yesterday keeps their package even if the admin deletes the catalog row today.

This is intentional — purchased packages are immutable subscriptions. To remove a per-student package, admins use a separate cancellation path (User Story 5 in spec.md).

## Failure modes

- FK violation (RESTRICT): caller sees raw "violates foreign key constraint" error. Phase 2 polish: catch and return `{ error: "هذه الباقة لها مشتركون نشطون. عطّلها بدلاً من حذفها." }`.
- Catalog row not found: returns `{ error: "Package not found" }`.

## Drift from target

- **D-001**: not yet wrapped in `loudAction`. Hard-delete is high-leverage for audit hook.
- FK error message is unfriendly (T10 follow-up).
