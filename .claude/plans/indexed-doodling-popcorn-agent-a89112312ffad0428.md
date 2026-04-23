# Plan: Site Announcement CMS + Public Banner

Build an admin CMS at `/admin/announcements` to manage the `site_announcements` table (V14.5), plus a server-rendered public banner that reads the active announcement and renders on every public page.

## Context Verified

- Schema `site_announcements` already exists (V14.5); RLS permits public SELECT on active rows, admin-only writes.
- Types `SiteAnnouncement` + `AnnouncementSeverity` already exported from `src/types/database.ts` (lines 601–619).
- Root layout (`src/app/layout.tsx`) already reads `furqan-lang` cookie server-side to pick `ar`/`en`. I'll reuse that pattern in the banner.
- Public layout lives at `src/app/(public)/layout.tsx`. Current top-of-return is `<PublicDirWrapper>` wrapping `<PublicNav />` then `<main>`. The banner must go at the very top, **before** `<PublicNav />`, inside `<PublicDirWrapper>` so it inherits dir.
- Admin conventions established (from `/admin/packages` and `/admin/services`):
  - `"use server"` actions with `requireAdmin()` helper (auth check → role check → returns supabase client)
  - `as never` casts on insert/update
  - `useActionState` for forms (imported from `react`)
  - `revalidatePath` after every mutation
  - Bilingual UI via `useLang` hook (`t("ar", "en")`) on client forms; hard-coded Arabic with optional English hint on server pages
  - `glass-card`, `glass-input`, `glass-pill`, `glass-gold`, `focus-ring`, `text-gold`, `text-muted` — existing Tailwind utility classes
- Lucide icons (`Info`, `AlertTriangle`, `AlertCircle`, `X`, `Pencil`, `Plus`, `ArrowRight`, `Save`, `CheckCircle`) are already imported elsewhere — fine to reuse.

## Files to Create

### 1. `src/app/admin/announcements/actions.ts` (server actions)

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("غير مصرح");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") throw new Error("ليس لديك صلاحية");
  return { supabase, userId: user.id };
}

type ActionState = { success?: boolean; error?: string; id?: string } | null;

function parseFormPayload(formData: FormData): { data: SaveShape | null; error?: string } {
  // Parse + validate:
  //   message_ar (required, trim), message_en (required, trim)
  //   severity (required, one of info|warning|critical)
  //   is_dismissible (checkbox)
  //   active_from (required, datetime-local → ISO; default = now if missing)
  //   active_until (optional datetime-local → ISO or null)
  //   cta_label_ar, cta_label_en, cta_href (CTA trio — if any is set, all three required)
  // Return { error: "..." } on validation failure, else { data }
}

export async function createAnnouncement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, userId } = await requireAdmin();
  const parsed = parseFormPayload(formData);
  if (parsed.error || !parsed.data) return { error: parsed.error ?? "بيانات غير صالحة" };
  const { error, data } = await supabase
    .from("site_announcements")
    .insert({ ...parsed.data, created_by: userId } as never)
    .select("id")
    .single<{ id: string }>();
  if (error) return { error: "فشل إنشاء الإعلان" };
  revalidatePath("/admin/announcements");
  revalidatePath("/");
  return { success: true, id: data?.id };
}

export async function updateAnnouncement(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const parsed = parseFormPayload(formData);
  if (parsed.error || !parsed.data) return { error: parsed.error ?? "بيانات غير صالحة" };
  const { error } = await supabase
    .from("site_announcements")
    .update(parsed.data as never)
    .eq("id", id);
  if (error) return { error: "فشل تحديث الإعلان" };
  revalidatePath("/admin/announcements");
  revalidatePath("/");
  return { success: true, id };
}

export async function deleteAnnouncement(id: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("site_announcements").delete().eq("id", id);
  if (error) return { error: "فشل حذف الإعلان" };
  revalidatePath("/admin/announcements");
  revalidatePath("/");
  return { success: true };
}

export async function deactivateAnnouncement(id: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("site_announcements")
    .update({ active_until: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) return { error: "فشل إيقاف الإعلان" };
  revalidatePath("/admin/announcements");
  revalidatePath("/");
  return { success: true };
}
```

**Validation rules** (in `parseFormPayload`):
- `message_ar` and `message_en`: required, non-empty trimmed strings → error "الرسالة بالعربية والإنجليزية مطلوبة"
- `severity`: must be one of `info | warning | critical` → fallback to `info`
- `active_from`: required — if missing, use `new Date().toISOString()`; otherwise parse datetime-local string via `new Date(value).toISOString()`
- `active_until`: optional; if non-empty, parse to ISO; if empty → null. Must be after `active_from` if both set → error "تاريخ الانتهاء يجب أن يكون بعد البدء"
- CTA trio: if any of `cta_label_ar`, `cta_label_en`, `cta_href` is non-empty, all three must be non-empty → error "عند إضافة زر إجراء، الاسمين العربي والإنجليزي والرابط كلها مطلوبة"
- `cta_href`: if present, must start with `/` or `http://` or `https://` → error "رابط الزر يجب أن يبدأ بـ / أو http"

### 2. `src/app/admin/announcements/announcement-form.tsx` (client form — shared by new + edit)

```tsx
"use client";
import { useActionState } from "react";
import { useLang } from "@/lib/i18n/context";
import { Save, CheckCircle, Info, AlertTriangle, AlertCircle } from "lucide-react";
import { createAnnouncement, updateAnnouncement } from "./actions";
import type { SiteAnnouncement, AnnouncementSeverity } from "@/types/database";

type State = { success?: boolean; error?: string; id?: string } | null;

// datetime-local expects "YYYY-MM-DDTHH:mm" — helper to convert ISO to that
function isoToLocal(iso: string | null): string { ... }

export function AnnouncementForm({ announcement }: { announcement?: SiteAnnouncement }) {
  const { t } = useLang();
  const action = announcement
    ? async (prev: State, fd: FormData) => updateAnnouncement(announcement.id, prev, fd)
    : async (prev: State, fd: FormData) => createAnnouncement(prev, fd);
  const [state, formAction, pending] = useActionState<State, FormData>(action, null);

  if (state?.success) {
    // success card with "back to list" link, same pattern as package-form
  }

  return (
    <form action={formAction} className="glass-card space-y-5 p-6">
      {/* error banner */}
      {state?.error && <div className="rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">{state.error}</div>}

      {/* message_ar, message_en — textareas, required, with htmlFor pairs */}
      {/* severity radios (info / warning / critical) with icon preview */}
      {/* is_dismissible checkbox (default true) */}
      {/* active_from datetime-local (default = now) */}
      {/* active_until datetime-local (optional) */}
      {/* cta_label_ar, cta_label_en, cta_href */}
      {/* submit button */}
    </form>
  );
}
```

All inputs will have a proper `<label htmlFor="id">` pairing and `id` on the input. Default `active_from` to the current datetime rendered in local format so the form is immediately submittable.

### 3. `src/app/admin/announcements/page.tsx` (list with sections)

Server component:
1. `requireAdmin` gate (redirect to `/login` if not admin).
2. Fetch all announcements: `supabase.from("site_announcements").select("*").order("active_from", { ascending: false }).returns<SiteAnnouncement[]>()`.
3. Partition server-side using `new Date()`:
   - **ACTIVE**: `active_from <= now && (active_until === null || active_until > now)`
   - **SCHEDULED**: `active_from > now`
   - **EXPIRED**: `active_until !== null && active_until <= now`
4. Render three sections (skip sections that are empty except show a "no active" hint on ACTIVE).
5. Each row shows:
   - Severity badge (colored pill, icon + label)
   - AR message preview (truncate to 80 chars)
   - Active window formatted with `Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" })`
   - Edit link → `/admin/announcements/{id}/edit`
   - Deactivate button (client island, only rendered if row is ACTIVE) → calls `deactivateAnnouncement`
   - Delete button (client island) → calls `deleteAnnouncement` with `confirm()`
6. "New" button at top → `/admin/announcements/new`

The per-row action buttons (deactivate + delete) need client-side `confirm()`, so extract them into a small client component `announcement-row-actions.tsx`.

### 4. `src/app/admin/announcements/announcement-row-actions.tsx` (client island)

Same pattern as `package-actions.tsx`:
- Props: `{ id: string; isActive: boolean }`
- Buttons: Edit (Link), Deactivate (if `isActive`), Delete (with `confirm`)
- Uses `useLang` for bilingual labels

### 5. `src/app/admin/announcements/new/page.tsx`

Thin server page: admin gate → renders `<AnnouncementForm />` (no `announcement` prop). Mirror `/admin/packages/new/page.tsx`.

### 6. `src/app/admin/announcements/[id]/edit/page.tsx`

Thin server page: admin gate → fetch announcement by id → render `<AnnouncementForm announcement={a} />`. Mirror `/admin/packages/[id]/edit/page.tsx`. Uses `params: Promise<{ id: string }>` per Next.js 16 async params.

### 7. `src/components/public/site-announcement-banner.tsx` (server component)

```tsx
import { cookies } from "next/headers";
import Link from "next/link";
import { Info, AlertTriangle, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { SiteAnnouncement } from "@/types/database";
import { AnnouncementDismissButton } from "./site-announcement-dismiss";

const ICON = { info: Info, warning: AlertTriangle, critical: AlertCircle } as const;
const STYLE = {
  info: "bg-sky-500/10 border-sky-500 text-sky-700 dark:text-sky-300",
  warning: "bg-amber-500/10 border-amber-500 text-amber-700 dark:text-amber-300",
  critical: "bg-red-500/10 border-red-500 text-red-700 dark:text-red-300",
} as const;

// severity rank for in-memory sort (Postgres can't order text by our priority cheaply)
const RANK = { critical: 3, warning: 2, info: 1 } as const;

export async function SiteAnnouncementBanner() {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("site_announcements")
    .select("*")
    .lte("active_from", nowIso)
    .or(`active_until.is.null,active_until.gt.${nowIso}`)
    .returns<SiteAnnouncement[]>();

  if (!data || data.length === 0) return null;

  // sort: severity DESC by RANK, then active_from DESC
  const sorted = [...data].sort((a, b) => {
    const r = RANK[b.severity] - RANK[a.severity];
    if (r !== 0) return r;
    return new Date(b.active_from).getTime() - new Date(a.active_from).getTime();
  });
  const a = sorted[0];

  // Pick language from cookie (same pattern as root layout.tsx)
  const cookieStore = await cookies();
  const lang = cookieStore.get("furqan-lang")?.value === "en" ? "en" : "ar";
  const message = lang === "en" ? a.message_en : a.message_ar;
  const ctaLabel = lang === "en" ? a.cta_label_en : a.cta_label_ar;
  const Icon = ICON[a.severity];

  return (
    <div
      role={a.severity === "critical" ? "alert" : "status"}
      aria-live={a.severity === "critical" ? "assertive" : "polite"}
      data-announcement-id={a.id}
      className={`border-l-4 ${STYLE[a.severity]} relative`}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 text-sm">
        <Icon size={18} className="shrink-0" aria-hidden />
        <p className="flex-1">{message}</p>
        {a.cta_href && ctaLabel && (
          <Link
            href={a.cta_href}
            className="shrink-0 rounded-full border border-current/30 px-3 py-1 text-xs font-medium transition-colors hover:bg-current/10"
          >
            {ctaLabel}
          </Link>
        )}
        {a.is_dismissible && <AnnouncementDismissButton id={a.id} />}
      </div>
    </div>
  );
}
```

Key decisions:
- Server component (async) — no client JS for the bar itself.
- Selects with `.lte("active_from", now).or("active_until.is.null,active_until.gt." + now)`. This uses the supabase `.or()` filter correctly per their docs.
- Severity sort done in JS after fetch (Postgres ENUM ordering would work with `severity DESC` if the enum is ordered critical>warning>info in DB declaration; since severity is `text CHECK` in the schema the in-memory sort is safer and explicit).
- Dismiss button is a tiny client island to read/write localStorage keyed by `announcement-dismissed-{id}`. The island hides the parent via CSS ancestor selector (parent has `data-announcement-id={a.id}`).

### 8. `src/components/public/site-announcement-dismiss.tsx` (client island)

```tsx
"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";

export function AnnouncementDismissButton({ id }: { id: string }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `announcement-dismissed-${id}`;
    if (localStorage.getItem(key) === "1") setDismissed(true);
  }, [id]);

  if (dismissed) {
    // Tell the rendering runtime to remove the bar by setting display:none on parent.
    // We do this via an injected <style> so it works without JS-manipulating the server-rendered DOM tree structure.
    return (
      <style dangerouslySetInnerHTML={{
        __html: `[data-announcement-id="${id}"]{display:none!important}`,
      }} />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        localStorage.setItem(`announcement-dismissed-${id}`, "1");
        setDismissed(true);
      }}
      aria-label="إخفاء الإعلان / Dismiss"
      className="shrink-0 rounded-full p-1 transition-colors hover:bg-current/10 focus-ring"
    >
      <X size={16} aria-hidden />
    </button>
  );
}
```

Why inject `<style>` instead of manipulating `document`:
- Server renders the banner DOM. If the island ran `parentElement.remove()`, React would complain about hydration mismatch and the DOM manipulation would be outside React's tree.
- An injected `<style>` tag is idempotent, survives re-renders, and is the canonical way to conditionally hide a sibling/ancestor node. The `id` is a UUID so the selector is safe from injection.

## Public Layout Change

### 9. `src/app/(public)/layout.tsx` (modify)

Current return (lines 24–39):
```tsx
<LangProvider>
  <FeatureFlagsProvider flags={flags}>
    <OrganizationSchema />
    <FAQSchema />
    <PublicDirWrapper>
      <PublicNav />
      <main id="main-content" className="pb-20 lg:pb-0">{children}</main>
      <PublicFooter />
      <WhatsAppButton />
      <MobileRegisterBar />
      <LazyWelcomePopup />
    </PublicDirWrapper>
  </FeatureFlagsProvider>
</LangProvider>
```

**Insert `<SiteAnnouncementBanner />` as the first child of `<PublicDirWrapper>`**, before `<PublicNav />`:

```tsx
<PublicDirWrapper>
  <SiteAnnouncementBanner />
  <PublicNav />
  <main id="main-content" className="pb-20 lg:pb-0">{children}</main>
  ...
```

Also add the import at the top:
```tsx
import { SiteAnnouncementBanner } from "@/components/public/site-announcement-banner";
```

Placement rationale: outside `<main>` (so it's not included in skip-to-content target), inside `<PublicDirWrapper>` (inherits `dir`), ahead of `<PublicNav>` so it sits at the very top edge.

## Admin Nav (optional nice-to-have)

Could add `/admin/announcements` to the nav at `src/components/shared/nav.tsx` in the CONTENT group. **Scope check**: the prompt doesn't require it, but leaving the page unlinked makes it invisible. I'll add a nav entry right after `/admin/blog` in the admin CONTENT group using the `Megaphone` icon from lucide. Tiny edit; keeps the CMS discoverable.

## Verification

After all files are written:
1. `npx tsc --noEmit` — must be clean.
2. `npx next build` — must pass.

If either fails I'll iterate on the failures.

## Files list (final)

Created:
- `src/app/admin/announcements/actions.ts`
- `src/app/admin/announcements/page.tsx`
- `src/app/admin/announcements/announcement-form.tsx`
- `src/app/admin/announcements/announcement-row-actions.tsx`
- `src/app/admin/announcements/new/page.tsx`
- `src/app/admin/announcements/[id]/edit/page.tsx`
- `src/components/public/site-announcement-banner.tsx`
- `src/components/public/site-announcement-dismiss.tsx`

Modified:
- `src/app/(public)/layout.tsx` — add `<SiteAnnouncementBanner />` + import
- `src/components/shared/nav.tsx` — add "الإعلانات" nav link under admin CONTENT group

## Risks / edge cases handled

- **Severity ordering**: severity is `text CHECK` not an ordered enum, so I sort in JS (deterministic).
- **Dismiss persistence**: keyed by announcement id, so when admin publishes a new announcement users see it again.
- **No hydration mismatch**: server renders the banner with the current announcement; the dismiss island only toggles a `<style>` tag. The bar itself isn't conditionally rendered based on client state.
- **Timezone**: `datetime-local` is local time. I convert to ISO via `new Date(value).toISOString()` in the action — Postgres `timestamptz` handles the conversion correctly. The list page renders ranges with `Intl.DateTimeFormat("ar", { dateStyle, timeStyle })` so admin sees familiar local time.
- **Empty message_en**: required via validator — preventing an English-only user from seeing a blank bar.
- **CTA partial**: trio validation prevents half-broken CTAs.
- **Public cache**: after any mutation, `revalidatePath("/")` is called. Home (and other public pages sharing the layout) re-renders on next visit. If more aggressive, `revalidatePath("/", "layout")` could be used — start with plain `"/"` which is sufficient for the layout's current non-dynamic-caching setup.
- **RLS**: public SELECT on active rows already exists per prompt — the banner uses the anon client through `createClient()` (cookie-backed) which returns the right rows even when logged out.
