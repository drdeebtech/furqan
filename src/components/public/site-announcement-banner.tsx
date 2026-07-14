import Link from "next/link";
import { cookies } from "next/headers";
import { Info, AlertTriangle, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { safeHref } from "@/lib/security/safe-url";
import type { SiteAnnouncement } from "@/types/database";
import { SiteAnnouncementDismiss } from "./site-announcement-dismiss";

const SEVERITY_RANK: Record<SiteAnnouncement["severity"], number> = {
  info: 1,
  warning: 2,
  critical: 3,
};

const SEVERITY_STYLES: Record<SiteAnnouncement["severity"], { bg: string; text: string; icon: React.ElementType }> = {
  info: { bg: "bg-gold/10 border-gold/40", text: "text-gold", icon: Info },
  warning: { bg: "bg-warning/10 border-warning/40", text: "text-warning", icon: AlertTriangle },
  critical: { bg: "bg-error/10 border-error/40", text: "text-error", icon: AlertCircle },
};

/**
 * Server component. Renders the currently-active site announcement with
 * highest severity. Returns null if none. The dismiss button is a client
 * island that injects a style rule keyed to the announcement id.
 */
export async function SiteAnnouncementBanner() {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data } = await supabase
    .from("site_announcements")
    .select("id, message_ar, message_en, severity, is_dismissible, active_from, active_until, cta_label_ar, cta_label_en, cta_href, created_by, created_at, updated_at")
    .lte("active_from", now)
    .or(`active_until.is.null,active_until.gt.${now}`)
    .order("active_from", { ascending: false })
    .returns<SiteAnnouncement[]>();

  const rows = data ?? [];
  if (rows.length === 0) return null;

  // Highest severity wins; fall back to most-recent active_from if tied.
  const chosen = [...rows].sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    return new Date(b.active_from).getTime() - new Date(a.active_from).getTime();
  })[0];

  const cookieStore = await cookies();
  const lang = cookieStore.get("furqan-lang")?.value === "en" ? "en" : "ar";
  const message = lang === "en" ? chosen.message_en : chosen.message_ar;
  const ctaLabel =
    chosen.cta_label_ar && chosen.cta_label_en
      ? lang === "en"
        ? chosen.cta_label_en
        : chosen.cta_label_ar
      : null;

  const styles = SEVERITY_STYLES[chosen.severity];
  const Icon = styles.icon;

  return (
    <div
      data-announcement-id={chosen.id}
      className={`site-announcement relative border-b ${styles.bg} px-4 py-2.5 text-sm`}
    >
      <div className={`mx-auto flex max-w-7xl items-center gap-3 ${chosen.is_dismissible ? "pe-10" : ""}`}>
        <Icon size={16} className={`shrink-0 ${styles.text}`} />
        <p className={`flex-1 ${styles.text}`}>{message}</p>
        {ctaLabel && chosen.cta_href && (
          <Link
            href={safeHref(chosen.cta_href)}
            className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${styles.text} hover:bg-white/5`}
          >
            {ctaLabel}
          </Link>
        )}
      </div>
      {chosen.is_dismissible && <SiteAnnouncementDismiss id={chosen.id} />}
    </div>
  );
}
