# Spec 031 — Shareable PDF Certificate + Bunny CDN + public `/certificates/[slug]`

Closes #539. Renders an Arabic/RTL certificate as a shareable PDF, stores it on
Bunny CDN, and serves a public, unguessable `/certificates/[slug]` page.

Build sheet. **Claude planned it; Codex implements.**

---

## Three-lens check
- 🛠 Engineer: capability-URL auth (unguessable v4 slug + fail-closed service-role projection, no enumeration); immutable cert ⇒ cache-forever; Node runtime + chromium sized for memory/timeout; Storage API key server-only; idempotent generation; zod-validate slug.
- 📖 Quran teacher: **zero Quran text generated** — only `surah:ayah` numbers (range-guarded at issue time) + Arabic surah *names* from canonical `src/lib/quran/surahs.ts`. Preserve Arabic byte-for-byte (shaping only, no transliteration).
- 🎓 Platform: RTL Arabic-first cert with a real Naskh font; unguessable share link = organic marketing; QR + branding drive back to furqan.today; `noindex` protects privacy while remaining shareable.

## What already exists
- `certificates` table (`supabase/migrations/20260620000001_reports_certificates.sql`), idempotent `issueCertificate()`; juz certs auto-issue (#540) → real rows to render.
- Arabic data: `profiles.full_name_ar`, surah names in `src/lib/quran/surahs.ts`, `cited_range_start/end` stored as `surah:ayah`.
- `qrcode` already installed. Playwright (e2e) already a dep.

## The one real gap (net-new, not a blocker)
The existing Bunny client (`src/lib/bunny/client.ts`) is **Bunny Stream (video) only** — no object storage. Storing a PDF needs **Bunny Edge Storage** (Storage Zones): `PUT https://<region>.storage.bunnycdn.com/<zone>/<path>`, `AccessKey` header, served via a pull-zone hostname. New module + new env vars.

## Decisions (settled)
1. **PDF engine = headless Chrome** (`puppeteer-core` + `@sparticuz/chromium`). `@react-pdf/renderer`/`pdfkit` do NOT shape Arabic ligatures/bidi — rejected. Render the **same** public cert HTML to PDF (one layout source of truth).
2. **⚠️ Arabic font is the #1 risk.** `@sparticuz/chromium` ships no Arabic font → boxes. MUST: bundle Amiri/Noto Naskh Arabic in the repo; inject via `@font-face`; `await document.fonts.ready` before `page.pdf()`; `dir="rtl"`/`lang="ar"` on the cert root. Test asserts shaped text, not tofu.
3. **Runtime:** PDF route `export const runtime = "nodejs"`, `maxDuration ~30`, memory 1024MB.
4. **Generate lazily, cache forever.** `GET /api/certificates/pdf/[slug]`: lookup by slug (404 if none) → if `pdf_url` set, 302 to Bunny URL → else render → PUT to Bunny (`certificates/{slug}.pdf`) → persist `pdf_url`+`pdf_generated_at` → redirect. Cert is immutable, so no invalidation.
5. **Public page** = Server Component `src/app/certificates/[slug]/page.tsx`: `full_name_ar` (fallback `full_name`), title (juz N / level / course), surah:ayah range with Arabic names, issue date, branding, verification QR (reuse `qrcode`), "Download PDF" button. `<meta robots noindex>`.
6. **Anti-leak = capability URL, not RLS.** Page has no session → read via `createAdminClient()` in a server-only `view.ts`, filtered by exact `public_slug`, returning only hand-picked safe columns. Unguessable slug IS the authorization; no slug match → 404, never list. Mirror honor-board's display-safe allow-list; never expose email/phone/dob/address.

## Migration / columns
```sql
alter table public.certificates
  add column if not exists public_slug uuid not null default gen_random_uuid(),
  add column if not exists pdf_url text,
  add column if not exists pdf_generated_at timestamptz;
create unique index if not exists uix_certificates_public_slug
  on public.certificates(public_slug);
```
- No new RLS policy (public read goes through the service-role route). Existing `certificates_select_self_or_guardian_or_admin` stays.
- The existing identity-guard trigger does **not** fire on `pdf_url`/`pdf_generated_at` (not in its column list) → on-demand writes work. Add `public_slug` to the guarded column list (defense-in-depth, so it can't be rotated by a non-service caller).

## Files
New: the migration; `src/lib/bunny/storage.ts` (Edge Storage client + `isBunnyStorageConfigured()`); `src/lib/domains/certificates/pdf.ts` (`renderCertificatePdf`, `server-only`); `src/lib/domains/certificates/view.ts` (`getPublicCertificate(slug)`); `src/app/certificates/[slug]/page.tsx`; `src/app/api/certificates/pdf/[slug]/route.ts`.
Changed: `.env.example` + setup doc; `src/lib/csp.ts` (allow Bunny storage host in `img-src`/`connect-src` if embedding).
New env (server-only): `BUNNY_STORAGE_ZONE_NAME`, `BUNNY_STORAGE_API_KEY`, `BUNNY_STORAGE_HOSTNAME`, `BUNNY_STORAGE_REGION_ENDPOINT`.
New deps: `puppeteer-core`, `@sparticuz/chromium`.

## OPEN DECISION (confirm before build)
- Does a cert-listing UI exist for students to *find* their share link, or is surfacing the link in scope here vs. #552? (No cert UI exists in `.tsx` today.)

## Risks + test plan
1. **Arabic font not embedded → tofu** (highest): bundled font + `fonts.ready` await + visual assertion.
2. **Serverless Chrome cold-start/size** on Vercel: `@sparticuz/chromium`, Node runtime, cache so it runs ~once per cert. Fallback only if rejected: print-CSS page (but that fails "stored on Bunny").
3. **Slug leak via referrer/indexing:** `noindex`, no listing endpoint, strict Referrer-Policy.
4. **Bunny misconfig silently failing:** `isBunnyStorageConfigured()` guard, fail-closed 500, never persist a bad `pdf_url`.
- Tests: `view.ts` maps ranges → Arabic names + returns only safe columns (assert no PII); `pdf.ts` returns `%PDF` buffer with shaped Arabic; route generates-then-caches (spy Chrome render); bad uuid → 422, unknown → 404; E2E public page RTL + `noindex` + no PII; no enumeration oracle.

## Dependencies
#540 (juz auto-issue) — merged, supplies cert rows. #552 — keep self-contained; #552's UI can link to `/certificates/[slug]` rather than duplicate (don't build a generic achievements abstraction here).
