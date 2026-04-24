import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings, CheckCircle, XCircle, Database, ToggleRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { FeatureToggle } from "./feature-toggle";

export const metadata: Metadata = { title: "الإعدادات" };

export default async function AdminSettingsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch feature flags
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("key, value, description")
    .returns<{ key: string; value: string; description: string | null }[]>();
  const settingsMap = Object.fromEntries((settings ?? []).map(s => [s.key, s.value]));

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
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Settings size={24} className="text-gold" /> {t("إعدادات المنصة", "Platform Settings")}</h1>

      {/* Health check */}
      <div className="mb-6 glass-card rounded-xl p-6">
        <h2 className="mb-4 font-bold">{t("صحة النظام", "System Health")}</h2>
        <div className="space-y-2">
          {[
            { name: "Supabase", ok: hasSupabase },
            { name: "Daily.co (Video)", ok: hasDaily },
            { name: "Stripe (Payments)", ok: hasStripe },
          ].map(s => (
            <div key={s.name} className="flex items-center gap-2 text-sm">
              {s.ok ? <CheckCircle size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-red-400" />}
              <span className={s.ok ? "text-foreground" : "text-red-400"}>{s.name}</span>
              <span className="text-xs text-muted">{s.ok ? t("متصل", "Connected") : t("غير مهيأ", "Not configured")}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Platform stats */}
      <div className="mb-6 glass-card rounded-xl p-6">
        <h2 className="mb-4 font-bold">{t("إحصائيات المنصة", "Platform Stats")}</h2>
        <div className="grid grid-cols-3 gap-4">
          <div><p className="text-2xl font-bold text-gold">{userCount ?? 0}</p><p className="text-xs text-muted">{t("مستخدم", "Users")}</p></div>
          <div><p className="text-2xl font-bold text-gold">{teacherCount ?? 0}</p><p className="text-xs text-muted">{t("معلم", "Teachers")}</p></div>
          <div><p className="text-2xl font-bold text-gold">{bookingCount ?? 0}</p><p className="text-xs text-muted">{t("حجز", "Bookings")}</p></div>
        </div>
      </div>

      {/* Feature Flags */}
      <div className="mb-6 glass-card rounded-xl p-6">
        <h2 className="mb-4 flex items-center gap-2 font-bold"><ToggleRight size={16} className="text-gold" /> {t("إعدادات الميزات", "Feature Flags")}</h2>
        <div className="space-y-3">
          <FeatureToggle
            settingKey="hide_reviews"
            label={t("إخفاء التقييمات", "Hide Reviews")}
            description={t("إخفاء قسم التقييمات من الصفحات العامة", "Hide the reviews section on public pages")}
            initialValue={settingsMap["hide_reviews"] === "true"}
          />
          <FeatureToggle
            settingKey="hide_prices"
            label={t("إخفاء الأسعار", "Hide Prices")}
            description={t("إخفاء الأسعار من الصفحات العامة", "Hide prices on public pages")}
            initialValue={settingsMap["hide_prices"] === "true"}
          />
          <FeatureToggle
            settingKey="hide_teachers_page"
            label={t("إخفاء صفحة المعلمين", "Hide Teachers Page")}
            description={t("إخفاء صفحة المعلمين من القائمة العامة (الصفحة لا تزال متاحة بالرابط المباشر)", "Hide the teachers page from the public nav (direct-link access still works)")}
            initialValue={settingsMap["hide_teachers_page"] === "true"}
          />
          <FeatureToggle
            settingKey="retention_ui_disabled"
            label={t("تعطيل واجهة إشارات البقاء", "Disable Retention UI")}
            description={t("إخفاء صفحة /admin/retention والودجات أثناء فترة تسخين البيانات. الحسابات في الخلفية تستمر.", "Hide /admin/retention + widgets during data warmup. Background scoring continues.")}
            initialValue={settingsMap["retention_ui_disabled"] === "true"}
          />
        </div>
      </div>

      {/* Currencies */}
      <div className="mb-6 glass-card rounded-xl p-6">
        <h2 className="mb-4 font-bold">{t("العملات المدعومة", "Supported Currencies")}</h2>
        <div className="flex flex-wrap gap-2">
          {currencies.map(c => (
            <span key={c} className="glass-badge px-3 py-1 text-xs text-muted">{c}</span>
          ))}
        </div>
      </div>

      {/* Schema migrations */}
      <div className="mb-6 glass-card rounded-xl p-6">
        <h2 className="mb-4 flex items-center gap-2 font-bold"><Database size={16} className="text-gold" /> {t("إصدارات قاعدة البيانات", "Database Migrations")}</h2>
        {(migrations ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t("لا توجد سجلات ترحيل", "No migration records")}</p>
        ) : (
          <div className="space-y-2">
            {(migrations ?? []).map(m => (
              <div key={m.version} className="flex items-center justify-between glass-card rounded-lg px-4 py-2">
                <div>
                  <p className="text-sm font-medium text-gold">{m.version}</p>
                  <p className="text-xs text-muted">{m.description}</p>
                </div>
                <p className="text-xs text-muted">{new Date(m.applied_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US")}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="glass-card rounded-xl p-6">
        <h2 className="mb-4 font-bold">{t("روابط سريعة", "Quick Links")}</h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/audit" className="text-sm text-gold hover:text-gold-light">{t("سجل المراجعة ←", "Audit Log →")}</Link>
          <Link href="/admin/refund-policies" className="text-sm text-gold hover:text-gold-light">{t("سياسات الاسترداد ←", "Refund Policies →")}</Link>
          <Link href="/admin/notifications" className="text-sm text-gold hover:text-gold-light">{t("الإشعارات ←", "Notifications →")}</Link>
        </div>
      </div>
    </div>
  );
}
