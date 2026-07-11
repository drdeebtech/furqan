<div align="center">

# فرقان — FURQAN Quran Academy

**Online Quran academy connecting students with certified teachers worldwide.**

[![Live](https://img.shields.io/badge/live-furqan.today-1f8f4e?style=flat-square)](https://furqan.today)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?style=flat-square&logo=supabase)](https://supabase.com)
[![License](https://img.shields.io/badge/license-source--available-orange?style=flat-square)](LICENSE)

[Live site](https://furqan.today) · [Architecture](#architecture) · [Feature reference](docs/agents/project-reference.md)

</div>

---

## What it is

FURQAN is a production Quran-teaching platform: students book sessions with certified teachers, learn over built-in video, and have their **ḥifẓ** (memorization) and **murājaʿah** (review) tracked with a spaced-repetition scheduler. Teachers manage availability and capture structured post-session progress; admins run the platform from a real-time control tower. The entire interface is **Arabic-first** with right-to-left layout and an optional English toggle.

It is built and sized for **50,000 users** — performance budgets, write-amplification, batch-job sizing, and multi-tenant Row-Level Security are all designed against that target rather than retrofitted later.

> The repository is **source-available for transparency**, not open source — see [License](#license).

## Features

**For students**
- Browse and book certified teachers; manage upcoming and past sessions
- Join built-in video lessons (Daily.co)
- Track ḥifẓ progress, review schedule, and recitation feedback

**For teachers**
- Manage availability and confirm bookings
- Post-session capture: surah-and-ayah progress, recitation-error taxonomy, quality rating
- Automated follow-up and homework state machine

**For admins**
- Real-time control tower with operational widgets
- Teacher management, platform stats, audit trail
- Notification dispatch (multi-channel, quiet hours) and event-driven automation

**Platform**
- Spaced-repetition (SM-2) review scheduler for memorization retention
- Canonical Hafs/Madani ayah-count validation — impossible ranges are unrepresentable (defense in depth: server action **and** database guard)
- Event-driven automation via n8n; Telegram alerting; PWA install
- Arabic-first RTL UI with bilingual labels

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) · React 19 |
| Language | TypeScript 6 |
| Styling | Tailwind CSS 4 |
| Data | Supabase — Postgres, Row-Level Security, SQL functions, generated types |
| Video | Daily.co |
| Validation | Zod 4 |
| Testing | Vitest (unit) · Playwright (e2e) |
| Observability | Sentry |
| Automation | n8n (event webhooks, scheduled jobs) |
| Hosting | Vercel · Node 24 |

## Architecture

- **App Router, server-first** — server actions (`"use server"`) wrapped in a `loudAction` primitive so every database write surfaces its outcome to the user, the operator, and the audit log (a *No Silent Failures* policy).
- **Domain modules** — pedagogy logic (e.g. the SM-2 recompute) lives in pure, unit-tested `src/lib/domains/*` modules, separate from the persistence layer.
- **Event-driven** — state-change actions `emitEvent()` to n8n, which owns sub-daily schedules and fan-out automations.
- **Typed data access** — Supabase generated types, gated in CI against a byte-exact `supabase gen types` diff.
- **98 SQL migrations** managed via CI (`supabase db push --linked` as source of truth).
- **Spec-driven** — larger features go through a spec-kit workflow (`specs/`) before code; decisions are recorded as ADRs.

Full descriptive snapshot — stack, roles, tables, enums, SQL functions, event catalog, automation registry, file structure — lives in [`docs/agents/project-reference.md`](docs/agents/project-reference.md).

### Roles

Three roles: **student** · **teacher** · **admin**.

## Getting Started

```bash
npm install
npm run dev
```

Create `.env.local` with at least:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
DAILY_API_KEY=your_daily_api_key
```

The full variable → purpose table is in [`docs/agents/env-vars.md`](docs/agents/env-vars.md).

```bash
npm run build      # production build
npm run test:unit  # unit + integration (Vitest, fast)
npm test           # end-to-end (Playwright, slower — needs browsers)
npm run lint       # ESLint
```

## Deployment

Deployed on **Vercel** (Node 24). Database migrations apply through CI on push to `main`; scheduled jobs run on a self-hosted **n8n** instance rather than Vercel cron.

## License

This repository is **source-available for transparency** — **all rights reserved**.
The code is proprietary to FURQAN Academy and is **not** licensed for reuse,
modification, or redistribution. See [LICENSE](LICENSE).
