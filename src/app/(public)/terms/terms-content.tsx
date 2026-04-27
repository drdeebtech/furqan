"use client";

import { useLang } from "@/lib/i18n/context";
import { LegalBody } from "@/components/shared/legal-body";

const LAST_UPDATED_FALLBACK = "2026-04-23";

interface Props {
  override?: { bodyAr: string | null; bodyEn: string | null; updatedAt: string } | null;
}

export default function TermsContent({ override }: Props = {}) {
  const { t, lang } = useLang();

  // If admin has saved a body for the current locale, render it. Otherwise
  // fall back to the in-code JSX so the page still works pre-edit.
  const dbBody = lang === "ar" ? override?.bodyAr : override?.bodyEn;
  const lastUpdated = override?.updatedAt
    ? new Date(override.updatedAt).toISOString().slice(0, 10)
    : LAST_UPDATED_FALLBACK;

  return (
    <article className="mx-auto max-w-3xl px-6 py-20">
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold/80">
          {t("وثيقة قانونية", "Legal")}
        </p>
        <h1 className="font-display mt-3 text-4xl font-bold leading-tight md:text-5xl">
          {t("شروط الاستخدام", "Terms of Service")}
        </h1>
        <p className="mt-3 text-sm text-muted">
          {t("آخر تحديث:", "Last updated:")} {lastUpdated}
        </p>
      </header>

      <div className="prose prose-invert mt-10 max-w-none text-foreground/90 [&_h2]:font-display [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_p]:my-3 [&_p]:text-sm [&_p]:leading-relaxed [&_ul]:my-3 [&_ul]:list-disc [&_ul]:ps-6 [&_ul]:text-sm [&_li]:my-1.5">
        {dbBody ? <LegalBody body={dbBody} /> : (lang === "ar" ? <TermsAr /> : <TermsEn />)}
      </div>
    </article>
  );
}

function TermsAr() {
  return (
    <>
      <p>
        باستخدامك لأكاديمية فرقان (&quot;المنصة&quot;)، فإنك توافق على هذه الشروط. يرجى قراءتها بعناية.
      </p>

      <h2>1. الخدمة</h2>
      <p>
        نقدّم خدمات تعليمية لتعلّم القرآن الكريم عبر جلسات فيديو مباشرة مع معلمين حاصلين على الإجازة. المنصة متاحة على
        مدار الساعة ونستهدف توفراً يزيد عن 99%.
      </p>

      <h2>2. الحساب والمسؤولية</h2>
      <ul>
        <li>أنت مسؤول عن الحفاظ على سرية كلمة المرور.</li>
        <li>يجب أن تكون البيانات التي تقدمها صحيحة وكاملة.</li>
        <li>لا يُسمح بمشاركة الحساب بين مستخدمين مختلفين.</li>
        <li>للأطفال دون 13 عاماً، يجب على ولي الأمر إنشاء الحساب.</li>
      </ul>

      <h2>3. الدفع والباقات</h2>
      <ul>
        <li>تُحدد أسعار الباقات بوضوح قبل الشراء.</li>
        <li>الدفع عبر وسائل آمنة ومعتمدة.</li>
        <li>تُخصم الجلسات من رصيدك عند تأكيد الحجز.</li>
        <li>في حال إلغاء المعلم للجلسة، يُعاد الرصيد تلقائياً.</li>
        <li>الإلغاء من قِبلك قبل 24 ساعة من الجلسة: يُعاد الرصيد كاملاً. خلال 24 ساعة: يُخصم الرصيد.</li>
      </ul>

      <h2>4. السلوك المتوقع</h2>
      <ul>
        <li>احترام المعلمين والإدارة والطلاب الآخرين.</li>
        <li>عدم تسجيل الجلسات أو مشاركة محتواها دون إذن كتابي.</li>
        <li>عدم استخدام المنصة لأي غرض غير مشروع أو مخالف للآداب الإسلامية.</li>
      </ul>

      <h2>5. الملكية الفكرية</h2>
      <p>
        جميع المحتويات التعليمية، الشعارات، والعلامات التجارية هي ملك لأكاديمية فرقان أو مرخّصة لها. لا يُسمح بإعادة
        الاستخدام التجاري بدون إذن مسبق.
      </p>

      <h2>6. الاستئناف والشكاوى</h2>
      <p>
        لأي شكوى متعلقة بالمعلم أو جودة الخدمة، راسلنا على{" "}
        <a href="mailto:support@furqan.today" className="text-gold hover:text-gold-light">support@furqan.today</a>. نلتزم
        بالرد خلال 48 ساعة ومعالجة الشكوى خلال 7 أيام عمل.
      </p>

      <h2>7. التعليق والإنهاء</h2>
      <p>
        نحتفظ بالحق في تعليق أو إنهاء الحساب في حال انتهاك هذه الشروط، مع إشعار مسبق حيثما أمكن. يمكنك إنهاء حسابك في
        أي وقت من إعدادات الحساب.
      </p>

      <h2>8. إخلاء المسؤولية</h2>
      <p>
        نبذل جهداً معقولاً لضمان جودة الخدمة، لكن لا نضمن خلو المنصة من الأعطال الفنية أو الانقطاعات. لسنا مسؤولين عن
        الأضرار غير المباشرة.
      </p>

      <h2>9. تعديل الشروط</h2>
      <p>
        قد نُحدّث هذه الشروط من وقت لآخر. سنُخطرك بالتغييرات الجوهرية عبر البريد الإلكتروني قبل سريانها بـ 30 يوماً.
      </p>

      <h2>10. القانون الحاكم</h2>
      <p>
        تخضع هذه الشروط لقوانين جمهورية مصر العربية، مع احترام حقوق المستخدم الممنوحة بموجب قوانين بلد إقامته.
      </p>

      <h2>11. التواصل</h2>
      <p>
        لأي استفسار قانوني:{" "}
        <a href="mailto:legal@furqan.today" className="text-gold hover:text-gold-light">legal@furqan.today</a>.
      </p>
    </>
  );
}

function TermsEn() {
  return (
    <>
      <p>
        By using FURQAN Academy (&quot;the Platform&quot;), you agree to these terms. Please read them carefully.
      </p>

      <h2>1. Service</h2>
      <p>
        We provide Quran education through live video sessions with Ijazah-certified teachers. The Platform is
        available 24/7 with a target uptime above 99%.
      </p>

      <h2>2. Account and Responsibility</h2>
      <ul>
        <li>You are responsible for maintaining the confidentiality of your password.</li>
        <li>The information you provide must be accurate and complete.</li>
        <li>Account sharing between different users is not allowed.</li>
        <li>For children under 13, a parent must create the account.</li>
      </ul>

      <h2>3. Payment and Packages</h2>
      <ul>
        <li>Package prices are clearly stated before purchase.</li>
        <li>Payment is processed through secure, certified providers.</li>
        <li>Sessions are deducted from your balance upon booking confirmation.</li>
        <li>If the teacher cancels, the session is restored to your balance automatically.</li>
        <li>Your cancellation 24+ hours before the session: full refund. Within 24 hours: session is consumed.</li>
      </ul>

      <h2>4. Expected Conduct</h2>
      <ul>
        <li>Respect for teachers, staff, and other students.</li>
        <li>No recording of sessions or sharing their content without written permission.</li>
        <li>No use of the Platform for unlawful purposes or purposes contrary to Islamic ethics.</li>
      </ul>

      <h2>5. Intellectual Property</h2>
      <p>
        All educational content, logos, and trademarks are owned by or licensed to FURQAN Academy. Commercial reuse is
        not permitted without prior written consent.
      </p>

      <h2>6. Appeals and Complaints</h2>
      <p>
        For complaints about a teacher or service quality, email{" "}
        <a href="mailto:support@furqan.today" className="text-gold hover:text-gold-light">support@furqan.today</a>. We
        commit to responding within 48 hours and resolving the complaint within 7 business days.
      </p>

      <h2>7. Suspension and Termination</h2>
      <p>
        We reserve the right to suspend or terminate accounts that violate these terms, with prior notice where
        possible. You may terminate your account at any time from the account settings.
      </p>

      <h2>8. Disclaimer</h2>
      <p>
        We make reasonable efforts to ensure service quality, but do not guarantee the Platform will be free of
        technical faults or interruptions. We are not liable for indirect damages.
      </p>

      <h2>9. Changes to Terms</h2>
      <p>
        We may update these terms from time to time. We&apos;ll notify you of material changes via email 30 days
        before they take effect.
      </p>

      <h2>10. Governing Law</h2>
      <p>
        These terms are governed by the laws of the Arab Republic of Egypt, while respecting user rights granted by
        the laws of the user&apos;s country of residence.
      </p>

      <h2>11. Contact</h2>
      <p>
        For legal inquiries:{" "}
        <a href="mailto:legal@furqan.today" className="text-gold hover:text-gold-light">legal@furqan.today</a>.
      </p>
    </>
  );
}
