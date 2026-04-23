"use client";

import { useLang } from "@/lib/i18n/context";

const LAST_UPDATED = "2026-04-23";

export default function PrivacyContent() {
  const { t, lang } = useLang();

  return (
    <article className="mx-auto max-w-3xl px-6 py-20">
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold/80">
          {t("وثيقة قانونية", "Legal")}
        </p>
        <h1 className="font-display mt-3 text-4xl font-bold leading-tight md:text-5xl">
          {t("سياسة الخصوصية", "Privacy Policy")}
        </h1>
        <p className="mt-3 text-sm text-muted">
          {t("آخر تحديث:", "Last updated:")} {LAST_UPDATED}
        </p>
      </header>

      <div
        className="prose prose-invert mt-10 max-w-none text-foreground/90 [&_h2]:font-display [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-bold [&_p]:my-3 [&_p]:text-sm [&_p]:leading-relaxed [&_ul]:my-3 [&_ul]:list-disc [&_ul]:ps-6 [&_ul]:text-sm [&_li]:my-1.5"
      >
        {lang === "ar" ? <PrivacyAr /> : <PrivacyEn />}
      </div>
    </article>
  );
}

function PrivacyAr() {
  return (
    <>
      <p>
        تحترم أكاديمية فرقان خصوصيتك وتلتزم بحماية بياناتك الشخصية. توضح هذه الوثيقة نوع البيانات التي نجمعها، وكيفية
        استخدامها، وحقوقك المتعلقة بها.
      </p>

      <h2>1. البيانات التي نجمعها</h2>
      <ul>
        <li><strong>بيانات الحساب:</strong> الاسم الكامل، البريد الإلكتروني، رقم الهاتف.</li>
        <li><strong>بيانات الجلسات:</strong> سجل الحجوزات، الملاحظات، تقدم الحفظ، التقييمات.</li>
        <li><strong>بيانات الدفع:</strong> تعالَج عبر مزود خدمة دفع معتمد (Stripe). لا نخزن بيانات البطاقات على خوادمنا.</li>
        <li><strong>بيانات تقنية:</strong> عنوان IP، نوع المتصفح، الجهاز — لأغراض الأمان والتحليلات.</li>
      </ul>

      <h2>2. كيف نستخدم بياناتك</h2>
      <ul>
        <li>تقديم خدمات التعليم وإدارة حسابك وجدولة الجلسات.</li>
        <li>التواصل معك بخصوص حجوزاتك، الواجبات، التقييمات، وتحديثات الأكاديمية.</li>
        <li>معالجة المدفوعات وإصدار الفواتير.</li>
        <li>تحسين جودة الخدمة وتتبع الأداء الأكاديمي.</li>
        <li>الامتثال للالتزامات القانونية ومنع الاحتيال.</li>
      </ul>

      <h2>3. مشاركة البيانات</h2>
      <p>
        لا نبيع بياناتك. نشاركها فقط مع معلمك المخصص في نطاق الجلسات، ومع مزودي الخدمات التقنية (مثل Supabase لقاعدة
        البيانات، Daily.co لجلسات الفيديو، Resend للبريد الإلكتروني) وفق اتفاقيات تحفظ السرية.
      </p>

      <h2>4. حقوقك</h2>
      <ul>
        <li>الوصول إلى بياناتك وطلب نسخة منها.</li>
        <li>تصحيح أي بيانات غير دقيقة.</li>
        <li>طلب حذف حسابك وبياناتك (يُحتفظ ببيانات الدفع المحاسبية وفق المتطلبات القانونية).</li>
        <li>سحب موافقتك على معالجة البيانات في أي وقت.</li>
        <li>تقديم شكوى إلى جهة حماية البيانات المختصة في بلدك.</li>
      </ul>

      <h2>5. أمن البيانات</h2>
      <p>
        نستخدم التشفير (HTTPS/TLS) في النقل، وتشفيراً على مستوى قاعدة البيانات للبيانات الحساسة. نطبق سياسات وصول
        صارمة ونمارس التدقيق المنتظم.
      </p>

      <h2>6. الاحتفاظ بالبيانات</h2>
      <p>
        نحتفظ ببيانات حسابك طالما كان الحساب نشطاً. عند إغلاق الحساب، تُحذف البيانات التعليمية خلال 90 يوماً. تُحتفظ
        السجلات المالية للمدة القانونية المطلوبة (عادة 7 سنوات).
      </p>

      <h2>7. حقوق الأطفال</h2>
      <p>
        خدماتنا متاحة للطلاب من جميع الأعمار، لكن يجب على ولي الأمر إنشاء الحساب للأطفال دون الثالثة عشر والإشراف على
        استخدامهم. لا نجمع بيانات طفل دون إذن ولي الأمر.
      </p>

      <h2>8. ملفات تعريف الارتباط (Cookies)</h2>
      <p>
        نستخدم ملفات تعريف الارتباط للمصادقة، حفظ تفضيلات اللغة، وإدارة الجلسات. راجع
        {" "}<a href="/cookies" className="text-gold hover:text-gold-light">سياسة الكوكيز</a> لتفاصيل أكثر.
      </p>

      <h2>9. التواصل</h2>
      <p>
        لأي استفسار متعلق بالخصوصية، راسلنا على{" "}
        <a href="mailto:privacy@furqan.today" className="text-gold hover:text-gold-light">privacy@furqan.today</a>.
      </p>
    </>
  );
}

function PrivacyEn() {
  return (
    <>
      <p>
        FURQAN Academy respects your privacy and is committed to protecting your personal data. This document explains
        what data we collect, how we use it, and your rights.
      </p>

      <h2>1. Data We Collect</h2>
      <ul>
        <li><strong>Account data:</strong> full name, email, phone number.</li>
        <li><strong>Session data:</strong> booking history, notes, memorization progress, evaluations.</li>
        <li><strong>Payment data:</strong> processed via a certified payment provider (Stripe). We do not store card details on our servers.</li>
        <li><strong>Technical data:</strong> IP address, browser type, device — used for security and analytics.</li>
      </ul>

      <h2>2. How We Use Your Data</h2>
      <ul>
        <li>Deliver education services and manage your account and scheduling.</li>
        <li>Communicate about bookings, homework, evaluations, and academy updates.</li>
        <li>Process payments and issue invoices.</li>
        <li>Improve service quality and track academic progress.</li>
        <li>Comply with legal obligations and prevent fraud.</li>
      </ul>

      <h2>3. Data Sharing</h2>
      <p>
        We do not sell your data. We share it only with your assigned teacher within the scope of your sessions, and
        with technical service providers (Supabase for database, Daily.co for video, Resend for email) under
        confidentiality agreements.
      </p>

      <h2>4. Your Rights</h2>
      <ul>
        <li>Access your data and request a copy.</li>
        <li>Correct any inaccurate data.</li>
        <li>Request deletion of your account and data (financial records are retained as required by law).</li>
        <li>Withdraw consent at any time.</li>
        <li>File a complaint with your local data protection authority.</li>
      </ul>

      <h2>5. Data Security</h2>
      <p>
        We use encryption (HTTPS/TLS) in transit and database-level encryption for sensitive fields. We enforce strict
        access policies and conduct regular audits.
      </p>

      <h2>6. Data Retention</h2>
      <p>
        We retain account data while the account is active. After account closure, educational data is deleted within
        90 days. Financial records are retained for the legally required period (typically 7 years).
      </p>

      <h2>7. Children&apos;s Privacy</h2>
      <p>
        Our services are available to students of all ages, but a parent must create the account for children under 13
        and supervise their use. We do not collect a child&apos;s data without parental consent.
      </p>

      <h2>8. Cookies</h2>
      <p>
        We use cookies for authentication, language preference, and session management. See our{" "}
        <a href="/cookies" className="text-gold hover:text-gold-light">Cookie Policy</a> for details.
      </p>

      <h2>9. Contact</h2>
      <p>
        For any privacy inquiries, email us at{" "}
        <a href="mailto:privacy@furqan.today" className="text-gold hover:text-gold-light">privacy@furqan.today</a>.
      </p>
    </>
  );
}
