# Contract: `togglePackageActive()`

**File**: `src/app/admin/packages/actions.ts:120`
**Caller role**: `admin` (enforced at route adapter)
**State transition**: catalog row's `is_active` boolean flips
**`loudAction` wrap**: ❌ Not yet (D-001)

## Input

```ts
type TogglePackageActiveInput = (packageId: string, isActive: boolean);
```

## Output

```ts
type Result = { success: true } | { success: false; error: string };
```

## Pre-conditions checked

| Check | Where | FR |
|---|---|---|
| Caller is admin | Route adapter | FR-009 |
| Package row exists | TS / DB | FR-009 |

## Side effects

- UPDATE `packages` SET `is_active = $isActive` WHERE id = $packageId.
- `revalidatePath('/admin/packages')` and `'/(public)/packages')`.
- **No effect on existing `student_packages` rows.** Students who already purchased keep their package; only future PayPal capture is blocked when `is_active = false` (the public catalog hides inactive packages).

## Why this exists (vs. delete)

When admin wants to retire a package without breaking existing subscribers, `togglePackageActive(false)` hides the catalog entry from the public listing while preserving the row. New PayPal captures targeting this package would be blocked at the booking flow (the catalog query filters `is_active = true`). Existing `student_packages` rows continue to work — `deduct_package_session()` does not check `packages.is_active`.

This is the **preferred** way to retire a package. `deletePackage()` is for catalog rows that were never used.

## Failure modes

- Package not found: returns `{ error: "Package not found" }`.
- DB error: returns `{ error }`.

## Drift from target

- **D-001**: not yet wrapped in `loudAction`. Lower leverage than `savePackage`/`deletePackage` (less destructive) but still valuable for audit trail.

## Related (cross-spec)

- spec 003 (booking) consumes `packages.is_active` indirectly: at booking creation time, the package selection UI filters `is_active = true`. This contract does not affect spec 003 directly — only via the catalog filter that booking depends on.
