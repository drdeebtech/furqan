import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { SiteAnnouncement } from "@/types/database";
import { AnnouncementRowActions } from "./announcement-row-actions";

export const metadata: Metadata = { title: "الإعلانات · Announcements" };

const SEVERITY_BADGE: Record<SiteAnnouncement["severity"], string> = {
  info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  critical: "border-red-500/40 bg-red-500/10 text-red-300",
};

export default async function AdminAnnouncementsPage() {
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
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone size={24} className="text-gold" />
          <h1 className="text-xl font-bold">الإعلانات</h1>
        </div>
        <Link
          href="/admin/announcements/new"
          className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-semibold"
        >
          <Plus size={14} /> إنشاء تنبيه
        </Link>
      </header>

      <Section title="نشط · Active" rows={active} severityMap={SEVERITY_BADGE} />
      <Section title="مجدول · Scheduled" rows={scheduled} severityMap={SEVERITY_BADGE} />
      <Section title="منتهي · Expired" rows={expired} severityMap={SEVERITY_BADGE} muted />
    </div>
  );
}

function Section({
  title,
  rows,
  severityMap,
  muted,
}: {
  title: string;
  rows: SiteAnnouncement[];
  severityMap: Record<SiteAnnouncement["severity"], string>;
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
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border/60 bg-surface/40 px-4 py-3"
            >
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${severityMap[r.severity]}`}>
                {r.severity}
              </span>
              <p className="min-w-0 flex-1 truncate text-sm">{r.message_ar}</p>
              <span className="text-xs text-muted">
                {new Date(r.active_from).toLocaleDateString()}
                {r.active_until && ` → ${new Date(r.active_until).toLocaleDateString()}`}
              </span>
              <AnnouncementRowActions id={r.id} canDeactivate={isLive} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
