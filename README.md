# فرقان — FURQAN Quran Academy

Online Quran academy platform connecting students with certified teachers worldwide.

## Features

- Student portal: browse teachers, book sessions, track progress
- Teacher portal: manage availability, confirm bookings, video sessions
- Admin portal: platform stats, teacher management
- Built-in video sessions via Daily.co
- RTL Arabic-first bilingual interface (Arabic/English toggle)
- 7-page public marketing website

## Tech Stack

Next.js 16 · Supabase · Daily.co · Tailwind CSS 4 · TypeScript

## Environment Variables

Create `.env.local` with:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
DAILY_API_KEY=your_daily_api_key
```

## Getting Started

```bash
npm install
npm run dev
```

## Deployment

Deployed on Vercel. See `.env.local` for required variables.
