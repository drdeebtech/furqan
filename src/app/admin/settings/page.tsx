import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings, CheckCircle, XCircle, Database } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "الإعدادات" };

export default async function AdminSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: migrations } = await supabase.from("schema_migrations").select("version, description, applied_at")
    .order("applied_at", { ascending: false }).returns<{ version: string; description: string | null; applied_at: string }[]>();

  const { count: userCount } = await supabase.from("profiles").select("id", { count: "exact", head: true });
  const { count: teacherCount } = await supabase.from("teacher_profiles").select("id", { count: "exact", head: true });
  const { count: bookingCount } = await supabase.from("bookings").select("id", { count: "exact", head: true });

  const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasDaily = !!process.env.DAILY_API_KEY;
  const hasStripe = !!process.env.STRIPE_SECRET_KEY;

  const currencies = ["USD", "KWD", "SAR", "EGP", "AED", "MAD", "QAR"];

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Settings size={24} className="text-gold" /> إعدادات المنصة</h1>

      {/* Health check */}
      <div className="mb-6 rounded-xl border border-card-border bg-card p-6">
        <h2 className="mb-4 font-bold">صحة النظام</h2>
        <div className="space-y-2">
          {[
            { name: "Supabase", ok: hasSupabase },
            { name: "Daily.co (Video)", ok: hasDaily },
            { name: "Stripe (Payments)", ok: hasStripe },
          ].map(s => (
            <div key={s.name} className="flex items-center gap-2 text-sm">
              {s.ok ? <CheckCircle size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-red-400" />}
              <span className={s.ok ? "text-foreground" : "text-red-400"}>{s.name}</span>
              <span className="text-xs text-muted">{s.ok ? "متصل" : "غير مهيأ"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Platform stats */}
      <div className="mb-6 rounded-xl border border-card-border bg-card p-6">
        <h2 className="mb-4 font-bold">إحصائيات المنصة</h2>
        <div className="grid grid-cols-3 gap-4">
          <div><p className="text-2xl font-bold text-gold">{userCount ?? 0}</p><p className="text-xs text-muted">مستخدم</p></div>
          <div><p className="text-2xl font-bold text-gold">{teacherCount ?? 0}</p><p className="text-xs text-muted">معلم</p></div>
          <div><p className="text-2xl font-bold text-gold">{bookingCount ?? 0}</p><p className="text-xs text-muted">حجز</p></div>
        </div>
      </div>

      {/* Currencies */}
      <div className="mb-6 rounded-xl border border-card-border bg-card p-6">
        <h2 className="mb-4 font-bold">العملات المدعومة</h2>
        <div className="flex flex-wrap gap-2">
          {currencies.map(c => (
            <span key={c} className="rounded-full border border-card-border px-3 py-1 text-xs text-muted">{c}</span>
          ))}
        </div>
      </div>

      {/* Schema migrations */}
      <div className="mb-6 rounded-xl border border-card-border bg-card p-6">
        <h2 className="mb-4 flex items-center gap-2 font-bold"><Database size={16} className="text-gold" /> إصدارات قاعدة البيانات</h2>
        {(migrations ?? []).length === 0 ? (
          <p className="text-sm text-muted">لا توجد سجلات ترحيل</p>
        ) : (
          <div className="space-y-2">
            {(migrations ?? []).map(m => (
              <div key={m.version} className="flex items-center justify-between rounded-lg border border-card-border bg-surface px-4 py-2">
                <div>
                  <p className="text-sm font-medium text-gold">{m.version}</p>
                  <p className="text-xs text-muted">{m.description}</p>
                </div>
                <p className="text-xs text-muted">{new Date(m.applied_at).toLocaleDateString("ar-SA")}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h2 className="mb-4 font-bold">روابط سريعة</h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/audit" className="text-sm text-gold hover:text-gold-light">سجل المراجعة ←</Link>
          <Link href="/admin/refund-policies" className="text-sm text-gold hover:text-gold-light">سياسات الاسترداد ←</Link>
          <Link href="/admin/notifications" className="text-sm text-gold hover:text-gold-light">الإشعارات ←</Link>
        </div>
      </div>
    </div>
  );
}
