# Spec 039 — Shannon Security-Audit Remediation

**Status:** all confirmed findings fixed (backlog items noted) · **Date:** 2026-07-13
**Source:** Shannon (KeygraphHQ AI pentester) v1.9.0 run against a **local** dev
instance (`exploit: false` — recon + white-box source analysis + vuln
identification, no live exploitation). 8 agents, 154 min, ~$37, 11 findings.
Report: `~/.shannon/workspaces/host-docker-internal_shannon-1783949550866/Security-Assessment-Report.md`.

Every finding below was **re-verified against the real code** before action —
Shannon is an AI and its claims were treated as leads, not gospel.

---

## Triage (three lenses: 🛠 engineer · 📖 Quran/teaching · 🎓 platform)

| ID | Title | Verdict | Action |
|----|-------|---------|--------|
| SSRF-VULN-01 | Blind SSRF via Web Push endpoint (no IP/host allowlist) | **Confirmed — code bug** | ✅ Fixed (commit `57f0e440`) |
| AUTHZ-VULN-01 | Guardian links to any student by email, no relationship proof | **Confirmed — product gap** | ✅ Fixed via claim-code (commit `fc2dbe4b`) |
| AUTH-VULN-02 | No per-IP rate limit on auth → cross-account spraying | **Confirmed** | ✅ Fixed (commit `6043a6de`) |
| AUTHZ-VULN-02 | Student server actions lack `requireRole`, write via admin client | **Confirmed — defense-in-depth** | ✅ Fixed (commit `87dc64b6`) |
| XSS-VULN-01 | `cta_href` announcement banner not protocol-validated | Real but runtime-mitigated (React 19 + CSP) | ✅ Fixed (commit `dabfe608`) |
| AUTH-VULN-01/05 | Session cookies lack HttpOnly / Secure | By design (`@supabase/ssr`); CSP is the real defense; prod has HSTS | Documented, no code change |
| AUTH-VULN-06 | BotID disabled off-Vercel | Expected (runs in prod); sub-point: fails *open* on ambiguous → review | Backlog |
| AUTH-VULN-03 | Distinct errors for banned/unconfirmed accounts | Minor enum vs. UX tradeoff | Backlog (low) |
| AUTH-VULN-04 | No MFA for any role incl. admin | Product decision, not a bug | Backlog (admin-only?) |
| Injection | — | **None found** | — |

---

## Remediated

### SSRF-VULN-01 — commit `57f0e440`

`/api/push/subscribe` and `src/lib/push/send.ts` validated push endpoints only
as `https://` URLs, so `https://169.254.169.254/` and `https://127.0.0.1:8443/`
were accepted and stored; the cron push-sender then POSTed to them.
- New `src/lib/push/safe-endpoint.ts` — `isSafePushEndpoint()` rejects non-HTTPS,
  IP-literals (v4/v6/decimal/hex), and non-FQDN/internal hosts. Real push
  services are always public FQDNs, so no legitimate endpoint is rejected.
- Enforced at the subscribe boundary **and** re-checked at send time (rows
  stored before the fix can't fire either).
- **Known limit:** hostname-based, so no DNS-rebinding protection (documented in
  code with the upgrade path). Blind + encrypted body makes that residual low.
- Verified: unit test (4/4, both live exploit URLs blocked) + `tsc` + build.

### AUTHZ-VULN-01 — commit `fc2dbe4b`

`/api/guardian/add-child` linked a guardian to any `role='student'` account
knowing only the email — exposing minors' teacher notes, monthly reports, and
certificates. (Shannon's "email enumeration" sub-claim was already mitigated:
the endpoint returns a uniform 422.)
- **Decision (owner-chosen): claim-code.** Each student has a
  `guardian_link_code` (migration `20260721000000`: nullable column, per-row
  backfill, DEFAULT for new rows — expand-safe). The student sees it on their
  settings page (RTL card) and shares it out-of-band; the guardian must supply
  it with the email. Mismatch → uniform 422 (no enumeration). Fail-closed on a
  null/absent code.
- Matching is a pure, unit-tested helper (`src/lib/auth/guardian-link-code.ts`,
  5/5 tests). No guardian-facing UI exists yet, so the new requirement breaks no
  current flow; a future guardian link form must include the code field.
- Verified: unit tests + `tsc` + build + migration applied & checked on the
  local DB. **Visual RTL check of the settings card is pending a human eyeball**
  — the vision tool was unavailable in the build session; content render was
  confirmed via text extraction and the screenshot was handed to the owner.

---

## Remediated — round 2 (commits on branch)

1. **AUTH-VULN-02** (`6043a6de`) — per-IP rate limit wired into login (50/hr),
   register (20/hr), forgot-password (20/hr) via the previously-unused IP-keyed
   `checkRateLimit`. Trusted-proxy IP (spoof-proof on Vercel); fail-open with the
   per-email limit as backstop; dev + `@furqan.test` accounts exempt.
2. **AUTHZ-VULN-02** (`87dc64b6`) — in-action `role === 'student'` guard added to
   `requestJoinGroupSession`, `enrollInHalaqa`, `joinHalaqaWaitingList`. Own-row
   cancel/leave paths left as-is (out of scope, lower risk).
3. **XSS-VULN-01** (`dabfe608`) — `safeHref()` render backstop applied to the
   announcement `cta_href`.

Verified: `tsc` clean + full production build green + existing `safeHref` suite
(44 tests) passing. No new unit tests: the role guard mirrors the existing
`login()`/`add-child` pattern and the IP layer wraps the already-tested
`checkRateLimit` — consistent with how the codebase treats these infra paths.

## Backlog (deferred, low priority)

## Notes / non-actions

- HttpOnly/Secure (AUTH-VULN-01/05): inherent to `@supabase/ssr`'s hybrid auth;
  the CSP (no `unsafe-inline`) is the real XSS defense. Do not flip without
  leaving `@supabase/ssr`.
- BotID (AUTH-VULN-06): runs in prod (Vercel). Worth reviewing its
  fail-**open** on ambiguous classification → make it fail-closed.
