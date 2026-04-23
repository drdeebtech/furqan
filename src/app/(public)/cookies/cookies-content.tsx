"use client";

import { useLang } from "@/lib/i18n/context";

const LAST_UPDATED = "2026-04-23";

export default function CookiesContent() {
  const { t, lang } = useLang();

  return (
    <article className="mx-auto max-w-3xl px-6 py-20">
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold/80">
          {t("وثيقة قانونية", "Legal")}
        </p>
        <h1 className="font-display mt-3 text-4xl font-bold leading-tight md:text-5xl">
          {t("سياسة ملفات تعريف الارتباط", "Cookie Policy")}
        </h1>
        <p className="mt-3 text-sm text-muted">
          {t("آخر تحديث:", "Last updated:")} {LAST_UPDATED}
        </p>
      </header>

      <div className="prose prose-invert mt-10 max-w-none text-foreground/90 [&_h2]:font-display [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_p]:my-3 [&_p]:text-sm [&_p]:leading-relaxed [&_ul]:my-3 [&_ul]:list-disc [&_ul]:ps-6 [&_ul]:text-sm [&_li]:my-1.5 [&_table]:my-4 [&_table]:w-full [&_table]:text-sm [&_th]:border [&_th]:border-surface-border [&_th]:p-2 [&_th]:text-start [&_td]:border [&_td]:border-surface-border [&_td]:p-2">
        {lang === "ar" ? <CookiesAr /> : <CookiesEn />}
      </div>
    </article>
  );
}

function CookiesAr() {
  return (
    <>
      <h2>ما هي ملفات تعريف الارتباط؟</h2>
      <p>
        ملفات تعريف الارتباط (Cookies) هي ملفات نصية صغيرة يحفظها متصفحك. نستخدمها فقط لضمان عمل المنصة بشكل صحيح —
        لا نستخدم كوكيز تتبع إعلاني.
      </p>

      <h2>أنواع الكوكيز التي نستخدمها</h2>
      <table>
        <thead>
          <tr>
            <th>الاسم</th>
            <th>الغرض</th>
            <th>المدة</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>furqan-lang</td>
            <td>حفظ اختيارك للغة (عربي / إنجليزي)</td>
            <td>سنة واحدة</td>
          </tr>
          <tr>
            <td>sb-*</td>
            <td>جلسة المصادقة (Supabase Auth)</td>
            <td>حتى تسجيل الخروج</td>
          </tr>
          <tr>
            <td>furqan-welcome-seen</td>
            <td>عدم إظهار النافذة الترحيبية مرتين</td>
            <td>دائم</td>
          </tr>
          <tr>
            <td>theme</td>
            <td>حفظ اختيار الوضع الفاتح / الداكن</td>
            <td>سنة واحدة</td>
          </tr>
        </tbody>
      </table>

      <h2>هل تستخدمون كوكيز لأطراف ثالثة؟</h2>
      <p>
        لا نستخدم كوكيز تتبع من Facebook أو Google Ads أو أي شبكة إعلانية. Supabase يُصدر كوكيز مصادقة على نطاقنا
        الفرعي فقط.
      </p>

      <h2>كيف أعطل الكوكيز؟</h2>
      <p>
        يمكنك تعطيلها من إعدادات متصفحك، لكن هذا سيمنعك من تسجيل الدخول أو حفظ تفضيلاتك. المنصة ستبقى متاحة للتصفح
        فقط.
      </p>
    </>
  );
}

function CookiesEn() {
  return (
    <>
      <h2>What are cookies?</h2>
      <p>
        Cookies are small text files your browser stores. We use them only to make the Platform work — we do not use
        advertising or tracking cookies.
      </p>

      <h2>Cookies we use</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Purpose</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>furqan-lang</td>
            <td>Persist your language choice (Arabic / English)</td>
            <td>1 year</td>
          </tr>
          <tr>
            <td>sb-*</td>
            <td>Authentication session (Supabase Auth)</td>
            <td>Until sign-out</td>
          </tr>
          <tr>
            <td>furqan-welcome-seen</td>
            <td>Don&apos;t show the welcome modal twice</td>
            <td>Persistent</td>
          </tr>
          <tr>
            <td>theme</td>
            <td>Persist light / dark mode choice</td>
            <td>1 year</td>
          </tr>
        </tbody>
      </table>

      <h2>Do you use third-party cookies?</h2>
      <p>
        We do not use tracking cookies from Facebook, Google Ads, or any ad network. Supabase issues authentication
        cookies on our subdomain only.
      </p>

      <h2>How do I disable cookies?</h2>
      <p>
        You can disable them in your browser settings, but this will prevent you from signing in or saving your
        preferences. The Platform will remain available for browsing only.
      </p>
    </>
  );
}
