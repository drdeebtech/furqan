# Contract: `getHomeworkAudioUrl()`

**File**: `src/lib/actions/homework.ts:446`
**Caller role**: `student` (own follow-up) or `teacher` (their student's follow-up) or `admin`
**State transition**: none — read-only access to audio file
**`loudAction` wrap**: ❌ Not yet (D-001)

## Input

```ts
type GetHomeworkAudioUrlInput = (homeworkId: string);
```

## Output

```ts
type Result = { ok: true; url: string; expiresAt: string } | { ok: false; error: string };
```

## Why this exists

The `audio_url` column may store a signed Supabase Storage URL with a short TTL. When the URL expires, callers (student player, teacher review UI, admin) need a fresh signed URL minted on-demand. This action wraps that mint-and-return.

## Pre-conditions checked

| Check | Where | FR |
|---|---|---|
| Caller is authenticated | Route adapter | FR-002, FR-003 |
| Caller has read access to the homework row (own student, own teacher, or admin) | SELECT with RLS | FR-002, FR-003 |
| Homework row has a non-NULL `audio_url` | TS guard | FR-005 |

## Side effects

- Mint a fresh signed URL via Supabase Storage `createSignedUrl(bucket, path, expiresIn)`. No DB write.
- Optionally: `audit_log` insert for `severity='info'` to track who accessed which audio when (operator policy decision — currently none).

## Failure modes

- Audio file deleted from Storage (manual cleanup, retention policy): returns `{ error: "audio not found" }`. The `audio_url` column may still point at the gone file (no cleanup-on-delete coupling today).
- Storage SDK failure: returns `{ error }`.

## Drift from target

- **D-001**: not yet wrapped in `loudAction`. Read-only path; lower priority for wrap pass than the write paths.
- No audit trail of who fetched which audio when. Phase 2 candidate if compliance/PII concerns surface.
