import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Mail, Inbox, CheckCircle, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { getT } from "@/lib/i18n/server";
import { MarkReadButton } from "./mark-read";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "رسائل التواصل" };

export default async function AdminContactsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) redirect("/login");

  const { data, error } = await supabase
    .from("contact_submissions")
    .select("id, full_name, email, whatsapp, country, student_age, package_interest, message, is_read, is_replied, created_at")
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<{
      id: string; full_name: string; email: string; whatsapp: string | null;
      country: string | null; student_age: string | null; package_interest: string | null;
      message: string | null; is_read: boolean; is_replied: boolean; created_at: string;
    }[]>();

  if (error) {
    logError("Failed to fetch contact submissions", error, { tag: "admin-contacts" });
  }

  const submissions = data ?? [];
  const unreadCount = submissions.filter(s => !s.is_read).length;

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold"><Mail size={24} className="text-gold" /> {t("رسائل التواصل", "Contact Messages")}</h1>
      <p className="mb-6 text-sm text-muted">
        {lang === "ar"
          ? `${submissions.length} رسالة · ${unreadCount} غير مقروءة`
          : `${submissions.length} message${submissions.length === 1 ? "" : "s"} · ${unreadCount} unread`}
      </p>

      {submissions.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" />}
          message={t("لا توجد رسائل بعد", "No messages yet")}
        />
      ) : (
        <div className="space-y-3">
          {submissions.map(s => (
            <div key={s.id} className={`glass-card rounded-xl p-5 ${!s.is_read ? "border-gold/30 bg-gold/5" : ""}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{s.full_name}</p>
                    {!s.is_read && <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-bold text-background">{t("جديد", "New")}</span>}
                    {s.is_replied && <CheckCircle size={14} className="text-green-400" />}
                  </div>
                  <p className="mt-1 text-sm text-muted" dir="ltr">{s.email}{s.whatsapp ? ` · ${s.whatsapp}` : ""}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {s.country && <span className="glass-badge px-2 py-0.5">{s.country}</span>}
                    {s.student_age && <span className="glass-badge px-2 py-0.5">{s.student_age} {t("سنوات", "yrs")}</span>}
                    {s.package_interest && <span className="glass-badge border-gold/30 bg-gold/10 px-2 py-0.5 text-gold">{s.package_interest}</span>}
                  </div>
                  {s.message && (
                    <div className="mt-3 glass-card rounded-lg p-3">
                      <p className="text-sm">{s.message}</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <p className="text-xs text-muted">
                    <Clock size={12} className="inline" /> {new Date(s.created_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}
                  </p>
                  {!s.is_read && <MarkReadButton submissionId={s.id} />}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
