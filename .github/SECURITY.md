# Security policy

FURQAN Academy serves real students and real teachers, including children.
Security reports are taken seriously.

## Reporting a vulnerability

**Do not file a public issue.** The repository is private, but please still
follow private-disclosure conventions while we coordinate a fix.

Email: **drdeebtech@gmail.com**

Please include:

- A short description of the issue.
- Reproduction steps (URL, request body, or a small video where helpful).
- The impact you observed (data exposure, account takeover, denial of
  service, etc.).
- Any suggested mitigation if you have one.

We aim to acknowledge reports within **48 hours** and to ship a fix
(or a documented mitigation) within **7 days** for high-severity issues.

## Scope

In scope:

- The production application at `https://furqan.today` and any preview
  deployments under `furqan-*.vercel.app`.
- The Supabase project linked to this repo (project ref redacted).
- Any GitHub Actions workflow under `.github/workflows/` in this repo.

Out of scope (please do not test):

- Third-party dependencies (report to the upstream maintainer instead).
- Denial-of-service testing against production.
- Social engineering of FURQAN staff or teachers.
- Physical attacks against any server or person.

## Acknowledgements

We don't run a paid bug-bounty program. If your report is valid and
material, we're happy to credit you here in the public disclosure once
the fix is shipped, with your permission.
