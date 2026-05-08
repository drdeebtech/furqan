# Contract: `savePackage()`

**File**: `src/app/admin/packages/actions.ts:14`
**Caller role**: `admin` (enforced at route adapter)
**State transition**: ∅ → catalog row exists, OR existing catalog row updated
**`loudAction` wrap**: ❌ Not yet (D-001)

## Input

```ts
type SavePackageInput = (prevState: { success?: boolean; error?: string }, formData: FormData);
// FormData fields: id? (for update), package_type, name, name_ar, description?, description_ar?,
//                  session_count, duration_min, price_usd, price_gbp?, price_sar?, price_aud?,
//                  features (string[]), features_ar (string[]), is_active, is_featured, display_order
```

Used with React `useActionState`; the `prevState` shape echoes back into the next render.

## Output

```ts
type Result = { success: true } | { success: false; error: string };
```

## Pre-conditions checked

| Check | Where | FR |
|---|---|---|
| Caller is admin | Route adapter `requireRole("admin")` | FR-009 |
| `package_type` is one of the CHECK values | DB CHECK constraint (TS doesn't validate) | FR-009 |
| `price_usd > 0` | TS validation (assumed; verify) | FR-009 |
| `session_count >= 1` | TS validation (assumed; verify) | FR-009 |

## Side effects

- INSERT or UPDATE on `packages` row (depending on whether `id` is in formData).
- No notify, no event, no audit log today.
- Triggers `revalidatePath('/admin/packages')` and `revalidatePath('/(public)/packages')` so the change appears immediately.

## Failure modes

- DB CHECK violation (e.g., invalid `package_type`): returns `{ success: false, error }`.
- Bilingual fields missing (`name_ar` empty): returns error if validated; today may silently insert empty Arabic name (verify).
- Display-order collision: not enforced; multiple rows can share the same `display_order`.

## Drift from target

- **D-001**: not yet wrapped in `loudAction`. As an admin-facing destructive operation (catalog mutation), this is high-leverage for the wrap pass.
- No audit_log entry — admins changing prices is an operational event worth logging.
