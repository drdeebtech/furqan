import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Megaphone, Plus, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { SiteAnnouncement } from "@/types/database";
import { getT } from "@/lib/i18n/server";
import { AnnouncementRowActions } from "./announcement-row-actions";

export const metadata: Metadata = { title: "الإعلانات" };

const SEVERITY_BADGE: Record<SiteAnnouncement["severity"], string> = {
  info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  critical: "border-red-500/40 bg-red-500/10 text-red-300",
};

export default async function AdminAnnouncementsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || profile.role !== "admin") redirect("/login");

  const { data: rows } = await supabase
    .from("site_announcements")
    .select("id, message_ar, message_en, severity, is_dismissible, active_from, active_until, cta_label_ar, cta_label_en, cta_href, created_by, created_at, updated_at")
    .order("active_from", { ascending: false })
    .returns<SiteAnnouncement[]>();

  const now = Date.now();
  const all = rows ?? [];
  const active: SiteAnnouncement[] = [];
  const scheduled: SiteAnnouncement[] = [];
  const expired: SiteAnnouncement[] = [];
  for (const r of all) {
    const from = new Date(r.active_from).getTime();
    const until = r.active_until ? new Date(r.active_until).getTime() : null;
    if (from > now) scheduled.push(r);
    else if (until !== null && until <= now) expired.push(r);
    else active.push(r);
  }

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone size={24} className="text-gold" />
          <h1 className="text-xl font-bold">{t("الإعلانات", "Announcements")}</h1>
        </div>
        <Link
          href="/admin/announcements/new"
          className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-semibold"
        >
          <Plus size={14} /> {t("إنشاء تنبيه", "New Announcement")}
        </Link>
      </header>

      {all.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" aria-hidden="true" />
          <p className="text-muted">{t("لا توجد إعلانات بعد", "No announcements yet")}</p>
          <p className="mt-1 text-xs text-muted/70">
            {t("أنشئ تنبيهًا ليظهر في أعلى الموقع للمستخدمين.", "Create an announcement to display at the top of the site.")}
          </p>
        </div>
      ) : (
        <>
          <Section title={t("نشط", "Active")} rows={active} severityMap={SEVERITY_BADGE} lang={lang} />
          <Section title={t("مجدول", "Scheduled")} rows={scheduled} severityMap={SEVERITY_BADGE} lang={lang} />
          <Section title={t("منتهي", "Expired")} rows={expired} severityMap={SEVERITY_BADGE} lang={lang} muted />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  severityMap,
  lang,
  muted,
}: {
  title: string;
  rows: SiteAnnouncement[];
  severityMap: Record<SiteAnnouncement["severity"], string>;
  lang: "ar" | "en";
  muted?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className={muted ? "opacity-60" : ""}>
      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-[0.2em] text-muted">{title}</h2>
      <ul className="space-y-2">
        {rows.map((r) => {
          const now = Date.now();
          const from = new Date(r.active_from).getTime();
          const until = r.active_until ? new Date(r.active_until).getTime() : null;
          const isLive = from <= now && (until === null || until > now);
          const locale = lang === "ar" ? "ar-SA" : "en-US";
          const msg = lang === "ar" ? r.message_ar : (r.message_en || r.message_ar);
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border/60 bg-surface/40 px-4 py-3"
            >
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${severityMap[r.severity]}`}>
                {r.severity}
              </span>
              <p className="min-w-0 flex-1 truncate text-sm">{msg}</p>
              <span className="text-xs text-muted">
                {new Date(r.active_from).toLocaleDateString(locale)}
                {r.active_until && ` → ${new Date(r.active_until).toLocaleDateString(locale)}`}
              </span>
              <AnnouncementRowActions id={r.id} canDeactivate={isLive} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
