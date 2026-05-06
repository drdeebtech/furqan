import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings, CheckCircle, XCircle, AlertTriangle, Database, ToggleRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { FeatureToggle } from "./feature-toggle";
import { RefreshButton } from "./refresh-button";

export const metadata: Metadata = { title: "Platform Settings | الإعدادات" };

type ProbeStatus = "reachable" | "configured" | "missing" | "unreachable";

async function probeWithTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function AdminSettingsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [settingsRes, migrationsRes, userCountRes, teacherCountRes, bookingCountRes] = await Promise.all([
    supabase
      .from("platform_settings")
      .select("key, value, description")
      .returns<{ key: string; value: string; description: string | null }[]>(),
    supabase
      .from("schema_migrations")
      .select("version, description, applied_at")
      .order("applied_at", { ascending: false })
      .returns<{ version: string; description: string | null; applied_at: string }[]>(),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("teacher_profiles").select("id", { count: "exact", head: true }),
    supabase.from("bookings").select("id", { count: "exact", head: true }),
  ]);

  const settings = settingsRes.data;
  const migrations = migrationsRes.data;
  const userCount = userCountRes.count;
  const teacherCount = teacherCountRes.count;
  const bookingCount = bookingCountRes.count;

  const settingsMap = Object.fromEntries((settings ?? []).map(s => [s.key, s.value]));

  const hasSupabaseEnv = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasDailyEnv = !!process.env.DAILY_API_KEY;
  const hasStripeEnv = !!process.env.STRIPE_SECRET_KEY;
  const hasResendEnv = !!process.env.RESEND_API_KEY;
  const hasN8nEnv = !!(process.env.N8N_API_URL && process.env.N8N_API_KEY);
  const hasTelegramEnv = !!process.env.TG_BOT_TOKEN;

  const probes = await Promise.allSettled([
    hasSupabaseEnv
      ? probeWithTimeout(async () => {
          const res = await supabase.from("profiles").select("id").limit(1);
          if (res.error) throw res.error;
          return true;
        }, 1500)
      : Promise.resolve(null),
    hasDailyEnv
      ? probeWithTimeout(async (signal) => {
          const res = await fetch("https://api.daily.co/v1/", {
            method: "GET",
            headers: { Authorization: "Bearer " + process.env.DAILY_API_KEY },
            signal,
          });
          return !!res;
        }, 1500)
      : Promise.resolve(null),
    hasN8nEnv
      ? probeWithTimeout(async (signal) => {
          const res = await fetch(process.env.N8N_API_URL + "/workflows?limit=1", {
            headers: { "X-N8N-API-KEY": process.env.N8N_API_KEY ?? "" },
            signal,
          });
          return res.ok;
        }, 1500)
      : Promise.resolve(null),
    hasTelegramEnv
      ? probeWithTimeout(async (signal) => {
          const res = await fetch("https://api.telegram.org/bot" + process.env.TG_BOT_TOKEN + "/getMe", { signal });
          return res.ok;
        }, 1500)
      : Promise.resolve(null),
  ]);

  const probeOk = (idx: number): boolean => probes[idx].status === "fulfilled" && probes[idx].value === true;

  const supabaseStatus: ProbeStatus = !hasSupabaseEnv ? "missing" : probeOk(0) ? "reachable" : "unreachable";
  const dailyStatus: ProbeStatus = !hasDailyEnv
    ? "missing"
    : probes[1].status === "fulfilled" && probes[1].value !== null
      ? "reachable"
      : "unreachable";
  const stripeStatus: ProbeStatus = hasStripeEnv ? "configured" : "missing";
  const resendStatus: ProbeStatus = hasResendEnv ? "configured" : "missing";
  const n8nStatus: ProbeStatus = !hasN8nEnv ? "missing" : probeOk(2) ? "reachable" : "unreachable";
  const telegramStatus: ProbeStatus = !hasTelegramEnv ? "missing" : probeOk(3) ? "reachable" : "unreachable";

  const healthRows: { name: string; role: string; status: ProbeStatus }[] = [
    { name: "Supabase", role: t("قاعدة البيانات", "Database"), status: supabaseStatus },
    { name: "Daily.co", role: t("الفيديو", "Video"), status: dailyStatus },
    { name: "Stripe", role: t("المدفوعات", "Payments"), status: stripeStatus },
    { name: "Resend", role: t("البريد", "Email"), status: resendStatus },
    { name: "n8n", role: t("الأتمتة", "Automation"), status: n8nStatus },
    { name: "Telegram", role: t("التنبيهات", "Alerts"), status: telegramStatus },
  ];

  const renderStatus = (status: ProbeStatus) => {
    switch (status) {
      case "reachable":
        return {
          icon: <CheckCircle size={16} className="text-success" aria-hidden="true" />,
          textClass: "text-foreground",
          label: t("متصل", "Reachable"),
          labelClass: "text-success",
        };
      case "configured":
        return {
          icon: <CheckCircle size={16} className="text-success/70" aria-hidden="true" />,
          textClass: "text-foreground",
          label: t("مهيأ", "Configured"),
          labelClass: "text-success/70",
        };
      case "unreachable":
        return {
          icon: <AlertTriangle size={16} className="text-warning" aria-hidden="true" />,
          textClass: "text-warning",
          label: t("غير قابل للوصول", "Unreachable"),
          labelClass: "text-warning",
        };
      case "missing":
      default:
        return {
          icon: <XCircle size={16} className="text-red-400" aria-hidden="true" />,
          textClass: "text-red-400",
          label: t("غير مهيأ", "Not configured"),
          labelClass: "text-red-400",
        };
    }
  };

  const defaultCurrencies = ["USD", "KWD", "SAR", "EGP", "AED", "MAD", "QAR"];
  const currenciesRaw = settingsMap["supported_currencies"];
  const currencies = currenciesRaw
    ? currenciesRaw.split(",").map(c => c.trim()).filter(Boolean)
    : defaultCurrencies;

  const filteredMigrations = (migrations ?? []).filter(m => {
    const v = (m.version ?? "").replace(/^v/i, "");
    return v >= "9";
  });

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Settings size={24} className="text-gold" /> {t("إعدادات المنصة", "Platform Settings")}</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted" suppressHydrationWarning>
            {`Loaded: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`}
          </span>
          <RefreshButton ar="تحديث" en="Refresh" />
        </div>
      </div>

      {/* Health check */}
      <div className="mb-6 glass-card rounded-xl p-6">
        <h2 className="mb-4 font-bold">{t("صحة النظام", "System Health")}</h2>
        <div className="space-y-2">
          {healthRows.map(s => {
            const r = renderStatus(s.status);
            return (
              <div key={s.name} className="flex items-center gap-2 text-sm">
                {r.icon}
                <span className={r.textClass}>{s.name}</span>
                <span className="text-xs text-muted">({s.role})</span>
                <span className={"text-xs " + r.labelClass}>{r.label}</span>
              </div>
            );
          })}
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

      {/* Automation Flags */}
      <div className="mb-6 glass-card rounded-xl p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold"><ToggleRight size={16} className="text-gold" /> {t("التشغيل الآلي", "Automation Flags")}</h2>
          <Link href="/admin/automation" className="text-xs text-gold hover:text-gold-light">{t("لوحة الأتمتة الكاملة ←", "Full Automation Dashboard →")}</Link>
        </div>
        <div className="space-y-3">
          <FeatureToggle
            settingKey="automation_enabled"
            label={t("المفتاح الرئيسي للأتمتة", "Master Automation Switch")}
            description={t("يفعّل أو يعطّل جميع تدفقات n8n", "Toggles all n8n workflows")}
            initialValue={settingsMap["automation_enabled"] === "true"}
          />
          <FeatureToggle
            settingKey="whatsapp_enabled"
            label={t("تفعيل واتساب", "WhatsApp Channel")}
            description={t("إرسال الإشعارات عبر واتساب", "Enable WhatsApp delivery")}
            initialValue={settingsMap["whatsapp_enabled"] === "true"}
          />
          <FeatureToggle
            settingKey="ai_parent_reports_enabled"
            label={t("تقارير ولي الأمر بالذكاء الاصطناعي", "AI Parent Reports")}
            description={t("توليد تقارير الجلسة بالذكاء الاصطناعي", "Generate AI session reports")}
            initialValue={settingsMap["ai_parent_reports_enabled"] === "true"}
          />
          <FeatureToggle
            settingKey="teacher_quality_monitor_enabled"
            label={t("مراقبة جودة المعلم", "Teacher Quality Monitor")}
            description={t("احتساب مخاطر أداء المعلم", "Compute teacher performance risk")}
            initialValue={settingsMap["teacher_quality_monitor_enabled"] === "true"}
          />
          <FeatureToggle
            settingKey="retention_automation_enabled"
            label={t("أتمتة الاحتفاظ", "Retention Automation")}
            description={t("كشف الطلاب المعرّضين للتسرّب", "Detect at-risk students")}
            initialValue={settingsMap["retention_automation_enabled"] === "true"}
          />
          <FeatureToggle
            settingKey="renewal_campaigns_enabled"
            label={t("حملات تجديد الباقات", "Renewal Campaigns")}
            description={t("تذكيرات تجديد الباقة قبل الانتهاء", "Package renewal reminders")}
            initialValue={settingsMap["renewal_campaigns_enabled"] === "true"}
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
        <p className="mt-3 text-xs text-muted">
          {t("للتعديل: قاعدة البيانات → platform_settings → supported_currencies", "To edit: DB → platform_settings → supported_currencies")}
        </p>
      </div>

      {/* Schema migrations */}
      <div className="mb-6 glass-card rounded-xl p-6">
        <h2 className="mb-4 flex items-center gap-2 font-bold"><Database size={16} className="text-gold" /> {t("إصدارات قاعدة البيانات", "Database Migrations")}</h2>
        {filteredMigrations.length === 0 ? (
          <p className="text-sm text-muted">{t("لا توجد سجلات ترحيل", "No migration records")}</p>
        ) : (
          <div className="space-y-2">
            {filteredMigrations.map(m => {
              const desc = m.description ?? "";
              const truncated = desc.length > 80 ? desc.slice(0, 80) + "…" : desc;
              return (
                <div key={m.version} className="flex items-center justify-between glass-card rounded-lg px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gold">{m.version}</p>
                    <p className="truncate text-xs text-muted" title={desc}>{truncated}</p>
                  </div>
                  <p className="ms-3 shrink-0 text-xs text-muted">{new Date(m.applied_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US", { timeZone: "UTC" })}</p>
                </div>
              );
            })}
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
          <Link href="/admin/n8n" className="text-sm text-gold hover:text-gold-light">{t("لوحة n8n ←", "n8n Control →")}</Link>
          <Link href="/admin/automation" className="text-sm text-gold hover:text-gold-light">{t("الأتمتة ←", "Automation →")}</Link>
          <Link href="/admin/control-tower" className="text-sm text-gold hover:text-gold-light">{t("برج التحكم ←", "Control Tower →")}</Link>
        </div>
      </div>
    </div>
  );
}
