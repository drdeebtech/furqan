import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { SiteAnnouncement } from "@/types/database";
import { AnnouncementForm } from "../../announcement-form";

export const metadata: Metadata = { title: "تعديل تنبيه · Edit Announcement" };

export default async function EditAnnouncementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || profile.role !== "admin") redirect("/login");

  const { data: ann } = await supabase
    .from("site_announcements")
    .select("id, message_ar, message_en, severity, is_dismissible, active_from, active_until, cta_label_ar, cta_label_en, cta_href, created_by, created_at, updated_at")
    .eq("id", id)
    .single<SiteAnnouncement>();

  if (!ann) notFound();

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <Link
          href="/admin/announcements"
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-gold"
        >
          <ArrowRight size={12} className="rotate-180" /> {t("العودة للقائمة", "Back to List")}
        </Link>
        <h1 className="mt-3 text-xl font-bold">{t("تعديل تنبيه", "Edit Announcement")}</h1>
      </header>
      <AnnouncementForm mode="edit" announcement={ann} />
    </div>
  );
}
