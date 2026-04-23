import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AnnouncementForm } from "../announcement-form";

export const metadata: Metadata = { title: "تنبيه جديد · New Announcement" };

export default async function NewAnnouncementPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || profile.role !== "admin") redirect("/login");

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <Link
          href="/admin/announcements"
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-gold"
        >
          <ArrowRight size={12} className="rotate-180" /> العودة للقائمة
        </Link>
        <h1 className="mt-3 text-xl font-bold">تنبيه جديد</h1>
      </header>
      <AnnouncementForm mode="create" />
    </div>
  );
}
