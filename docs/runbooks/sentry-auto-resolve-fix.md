# Runbook — fix Sentry auto-resolve via GitHub keywords

**Status:** 🔧 Pending operator action
**Owner:** `alforqan.egy@gmail.com` (Sentry org owner)
**Estimated time:** 10 minutes

## Problem

PRs that include `Fixes JAVASCRIPT-NEXTJS-E4-<N>` in their commit messages should auto-close the matching Sentry issue once the next production release ships. Two PRs in a row (#78, #146) confirmed this is **not happening** — issues stay open after merge.

## Diagnosis

Verified on 2026-05-12:

| Check | Status |
|---|---|
| `setCommits: { auto: true }` in `next.config.ts:72` | ✅ |
| `SENTRY_AUTH_TOKEN` set in Vercel Production | ✅ |
| Releases created on every prod build (50+ in last 5 days) | ✅ |
| Sentry GitHub integration links repo to org | ❓ **suspected gap** |

`release.setCommits.auto: true` works by reading the previous release's commit, then asking Sentry's GitHub integration to enumerate commits between that SHA and the current one. If the integration is **not installed at the org level with read access to `drdeebtech/furqan`**, Sentry creates the release with an empty commit list — and the `Fixes` keyword has nothing to match.

## Fix — operator steps

1. Open <https://furqan-academy.sentry.io/settings/integrations/github/>.
2. If **GitHub** is not listed under "Installed":
   - Click **Add Installation**.
   - In the GitHub OAuth flow, select the **`drdeebtech`** account (not personal).
   - Grant access to repo **`drdeebtech/furqan`** (or "All repositories" if you prefer).
3. If GitHub **is** listed but the repo is missing:
   - Click **Configure** next to GitHub.
   - Under **Repositories**, click **Add Repository** → select `drdeebtech/furqan`.
4. Confirm the integration is **enabled at the project level**:
   - Open <https://furqan-academy.sentry.io/settings/projects/javascript-nextjs-e4/>.
   - Under **Code Mappings** or **Source Code Management**, link the GitHub repo if not already linked.

## Verification

After completing the operator steps, trigger one production build (any commit to `main`) and then:

### A. Check the release has commits attached

Open <https://furqan-academy.sentry.io/releases/> and click into the most recent release. Under **Commits**, you should see the list of commits since the previous release. If the section says "No commits found" — the integration is still mis-wired.

### B. Test the keyword

1. Pick any currently-open Sentry issue (e.g., `JAVASCRIPT-NEXTJS-E4-21`).
2. Open a small PR (e.g., a typo fix) with body or commit message containing exactly:
   ```
   Fixes JAVASCRIPT-NEXTJS-E4-21
   ```
3. Merge to `main`.
4. Wait for Vercel build + Sentry release creation (~2 minutes after merge).
5. Refresh the Sentry issue. Status should flip to **Resolved** (or **Resolved in next release**).

### C. Backlog cleanup

Once the integration works, any pre-existing PRs that already shipped with `Fixes E4-N` keywords (e.g., #78, #146) will **not** retroactively close their issues — Sentry only acts at release-creation time. Close those manually via the Sentry MCP `update_issue` tool or in the dashboard.

## If verification fails

Common causes:

- **GitHub App installed at the user level, not the org.** Re-install from the `drdeebtech` GitHub org settings, not your personal account.
- **`SENTRY_AUTH_TOKEN` lacks `project:releases` scope.** Regenerate the token with both `project:write` and `project:releases` scopes.
- **`release.create: isProductionDeploy` gate failing.** Confirm `VERCEL_ENV=production` is true on the build that should have triggered the release.

## Related

- CLAUDE.md → "Sentry GitHub auto-resolve — currently broken (follow-up)"
- next.config.ts:72 — `setCommits: { auto: true, ignoreMissingRepository: true }`
- Bad-list item #3 (rank 🥇 for ops debt)
