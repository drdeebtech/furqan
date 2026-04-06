import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Mail, Inbox, CheckCircle, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MarkReadButton } from "./mark-read";

export const metadata: Metadata = { title: "رسائل التواصل" };

export default async function AdminContactsPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) redirect("/login");

  const { data } = await supabase
    .from("contact_submissions")
    .select("id, full_name, email, whatsapp, country, student_age, package_interest, message, is_read, is_replied, created_at")
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<{
      id: string; full_name: string; email: string; whatsapp: string | null;
      country: string | null; student_age: string | null; package_interest: string | null;
      message: string | null; is_read: boolean; is_replied: boolean; created_at: string;
    }[]>();

  const submissions = data ?? [];
  const unreadCount = submissions.filter(s => !s.is_read).length;

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold"><Mail size={24} className="text-gold" /> رسائل التواصل</h1>
      <p className="mb-6 text-sm text-muted">{submissions.length} رسالة · {unreadCount} غير مقروءة</p>

      {submissions.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد رسائل بعد</p>
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map(s => (
            <div key={s.id} className={`rounded-xl border bg-card p-5 ${s.is_read ? "border-card-border" : "border-gold/30 bg-gold/5"}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{s.full_name}</p>
                    {!s.is_read && <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-bold text-background">جديد</span>}
                    {s.is_replied && <CheckCircle size={14} className="text-green-400" />}
                  </div>
                  <p className="mt-1 text-sm text-muted" dir="ltr">{s.email}{s.whatsapp ? ` · ${s.whatsapp}` : ""}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {s.country && <span className="rounded border border-card-border px-2 py-0.5">{s.country}</span>}
                    {s.student_age && <span className="rounded border border-card-border px-2 py-0.5">{s.student_age} سنوات</span>}
                    {s.package_interest && <span className="rounded border border-gold/30 bg-gold/10 px-2 py-0.5 text-gold">{s.package_interest}</span>}
                  </div>
                  {s.message && (
                    <div className="mt-3 rounded-lg border border-card-border bg-surface p-3">
                      <p className="text-sm">{s.message}</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <p className="text-xs text-muted">
                    <Clock size={12} className="inline" /> {new Date(s.created_at).toLocaleDateString("ar-SA")}
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
