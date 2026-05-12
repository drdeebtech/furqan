# Runbook — fix Supabase MCP wrong-account

**Status:** 🔧 Pending operator action
**Owner:** `dreldeeburo@gmail.com` (machine owner) + `alforqan.egy@gmail.com` (FURQAN Supabase owner)
**Estimated time:** 5 minutes

## Problem

The `mcp__claude_ai_Supabase__*` tools (and the local `supabase` CLI) are authenticated to `dreldeeburo@gmail.com`'s Supabase account — which owns `Dr Deeb Urology Clinic`, NOT FURQAN. FURQAN's project (`xyqscjnqfeusgrhmwjts`) lives under `alforqan.egy@gmail.com`.

Calls like `list_projects`, `get_advisors`, `execute_sql`, `get_logs`, and `apply_migration` silently target the **wrong project** if invoked blindly. They return urology-clinic data, not FURQAN. The CLAUDE.md "Re-run `get_advisors`" instruction (e.g. for leaked-password protection verification) silently fails today.

## Fix — operator steps

### Option A: Personal Access Token (recommended for programmatic access)

1. Open <https://supabase.com/dashboard/account/tokens> **while signed in as `alforqan.egy@gmail.com`** (not `dreldeeburo@gmail.com`).
2. Click **Generate new token**, name it `furqan-claude-code-cli`, scope `all` for now (Supabase doesn't yet expose fine-grained scopes per token).
3. Copy the token. **One-time display — won't be shown again.**
4. Export in your shell config (e.g. `~/.zshrc`):
   ```bash
   export SUPABASE_ACCESS_TOKEN_FURQAN="<token>"
   ```
5. When running the Supabase CLI against FURQAN, pass `--token`:
   ```bash
   supabase --token "$SUPABASE_ACCESS_TOKEN_FURQAN" projects list
   ```

This leaves the global `supabase login` session untouched for urology-clinic work.

### Option B: Switch the global CLI session

If you mostly work on FURQAN and rarely on urology-clinic:

```bash
supabase logout
supabase login   # authenticates against alforqan.egy@gmail.com
```

Drawback: every urology-clinic CLI call now needs `--token <urology-clinic-token>`. This is the reverse problem.

### MCP server (Claude Code-side)

The Supabase MCP server reads credentials from the host machine's `supabase login` session — there's no per-session override. Until Supabase exposes a token-flag for MCP, the MCP tools will always reflect whichever account `supabase login` last authenticated. So:

- **If you frequently invoke `mcp__claude_ai_Supabase__*` for FURQAN**: pick Option B.
- **If you mostly use the dashboard/browser for FURQAN**: stay on Option A and never use the MCP tools — they'll mislead.

## Verification

After completing steps:

```bash
# Should show furqan + xyqscjnqfeusgrhmwjts under the org
supabase --token "$SUPABASE_ACCESS_TOKEN_FURQAN" projects list

# Should NOT include any urology-clinic projects
```

In Claude Code, after `supabase logout && supabase login` (Option B):

```
mcp__claude_ai_Supabase__list_projects()
```

Should show FURQAN under `furqan` org, not urology clinic.

## CLAUDE.md update

After fixing, update CLAUDE.md → "Supabase MCP — wrong-account gotcha" section to reflect the resolved state (replace with a note that the operator switched accounts on `<date>` and confirm which option was used).

## Related

- CLAUDE.md → "Supabase MCP — wrong-account gotcha"
- Bad-list item #5 (P2 workflow friction)
- Blocks: any "Re-run `get_advisors`" verification step in CLAUDE.md (leaked password, RLS lint, etc.)
