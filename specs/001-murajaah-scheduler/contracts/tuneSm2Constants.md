# Contract — `tuneSm2Constants` server action

**Caller**: admin settings page (`/admin/settings`).
**Role gate**: `requireRole("admin")`.
**Domain function**: `updatePlatformSetting()` (existing helper in `src/lib/settings.ts`) — three calls, one per constant.
**Atomicity**: per-call (each constant is its own row in `platform_settings`); the form submits all three at once.

---

## Signature

```ts
// src/app/admin/settings/actions.ts
export const tuneSm2Constants = loudAction({
  name: "admin.murajaah.tune-sm2-constants",
  severity: "warning",            // changes affect all future schedule rows
  audit: {
    table: "platform_settings",
    recordId: () => "sm2_*",
    action: "UPDATE",
  },
  handler: async (input: {
    sm2_initial_interval_days: number;
    sm2_easiness_factor: number;
    sm2_lapse_penalty: number;
  }) => {
    const { id: adminId } = await requireRole("admin");
    validateSm2Constants(input);
    await Promise.all([
      updatePlatformSetting("sm2_initial_interval_days", String(input.sm2_initial_interval_days)),
      updatePlatformSetting("sm2_easiness_factor", String(input.sm2_easiness_factor)),
      updatePlatformSetting("sm2_lapse_penalty", String(input.sm2_lapse_penalty)),
    ]);
    revalidatePath("/admin/settings");
    return { message: "تم تحديث إعدادات المراجعة" };
  },
});
```

## Input validation (`validateSm2Constants`)

| Field | Range | Reason |
|---|---|---|
| `sm2_initial_interval_days` | integer in `[1, 30]` | <1 makes no sense; >30 means students never see new items |
| `sm2_easiness_factor` | real in `[1.3, 3.5]` | per SM-2 published bounds; matches the per-row check constraint |
| `sm2_lapse_penalty` | real in `[0.5, 1.0)` | <0.5 collapses EF to floor in 1-2 lapses; ≥1.0 would mean lapses *help*, which is wrong |

Validation errors throw a domain `MurajaahValidationError`; mapped at the route adapter to `<ActionFeedback>` red banner.

## Output

```ts
{ ok: true, message: "تم تحديث إعدادات المراجعة" }
| { ok: false, error: string }
```

## Error paths

| Error class | Trigger | Message |
|---|---|---|
| `UnauthenticatedError` | no session | redirect to `/login` |
| `ForbiddenError` | not admin | 403 |
| `MurajaahValidationError` | input out of bounds | specific Arabic message per field |

## Database mutation — sized for 50k

**Constitution Principle: admin EF is initial-only.** Per the clarify Q5 decision and `FR-006`, this server action writes **only** to `platform_settings` (3 rows). It does NOT cascade an UPDATE to existing `student_review_schedule` rows.

Concrete write count:
- 3 `platform_settings` UPDATEs.
- 1 `audit_log` INSERT (recording the admin's tune).
- Zero rows touched in `student_review_schedule`.

This is what the constitution v1.1.0 § "50,000-user scale target" requires: zero fan-out from admin tunes.

## Side effects (best-effort post-commit)

- `emitEvent("murajaah.tuned", { admin_id, before, after })` — n8n logs the change for audit and may notify ops on Telegram.

## Test plan

- **Unit**: vi.mock the settings helper; verify validation rejects out-of-bounds values, accepts edges.
- **Integration**: real Supabase fixture; verify the three rows update and `audit_log` records the change.
- **Regression**: assert that running this action does NOT touch `student_review_schedule`. Add an explicit test that counts rows-touched and asserts the schedule table count is unchanged. (This regression test exists *because* an earlier alternative — Option B in the clarify Q5 — would have triggered a 10M-row UPDATE storm.)
- **E2E**: Playwright sign-in as admin, change EF from 2.5 → 2.7, verify a fresh `student_progress` row inserted later spawns a schedule row with EF=2.7 on next cron tick, while existing rows remain untouched.
