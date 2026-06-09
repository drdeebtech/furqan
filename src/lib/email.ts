import { Resend } from "resend";
import { logError, logWarn } from "@/lib/logger";
import { sanitizeHeaderValue } from "@/lib/security/sanitize";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "drdeebtech@gmail.com";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendAdminTeacherApplicationAlert(data: {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  languages: string[];
  recitations: string[];
  specialties: string[];
  yearsExperience?: number;
  teacherId: string;
}) {
  const resend = getResend();
  if (!resend) {
    logWarn("RESEND_API_KEY not set — skipping admin teacher alert", { tag: "email" });
    return { error: "no-resend" };
  }
  const safe = {
    name: escapeHtml(data.fullName),
    email: escapeHtml(data.email),
    phone: escapeHtml(data.phone),
    country: escapeHtml(data.country),
    langs: escapeHtml(data.languages.join(", ")),
    rec: escapeHtml(data.recitations.join(", ")),
    spec: escapeHtml(data.specialties.join(", ")),
    years: data.yearsExperience ? escapeHtml(String(data.yearsExperience)) : "—",
  };
  const reviewUrl = `https://www.furqan.today/admin/teachers/cv/${encodeURIComponent(data.teacherId)}`;
  try {
    await resend.emails.send({
      from: `FURQAN Academy <${FROM_EMAIL}>`,
      to: ADMIN_EMAIL,
      subject: `🆕 طلب تدريس جديد — ${sanitizeHeaderValue(data.fullName)}`,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 640px;">
          <h2 style="color: #C8A652;">طلب تدريس جديد</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">الاسم:</td><td style="padding: 8px;">${safe.name}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">البريد:</td><td style="padding: 8px;"><a href="mailto:${safe.email}">${safe.email}</a></td></tr>
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">الهاتف:</td><td style="padding: 8px;">${safe.phone}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">الدولة:</td><td style="padding: 8px;">${safe.country}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">سنوات الخبرة:</td><td style="padding: 8px;">${safe.years}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">اللغات:</td><td style="padding: 8px;">${safe.langs}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">الروايات:</td><td style="padding: 8px;">${safe.rec}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">التخصصات:</td><td style="padding: 8px;">${safe.spec}</td></tr>
          </table>
          <p style="margin-top: 24px;">
            <a href="${reviewUrl}" style="display: inline-block; padding: 10px 20px; background: #C8A652; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">مراجعة الطلب</a>
          </p>
          <p style="margin-top: 24px; font-size: 12px; color: #999;">— أكاديمية فُرقان | furqan.today</p>
        </div>
      `,
    });
    return { success: true };
  } catch (error) {
    logError("Failed to send admin teacher application alert", error, { tag: "email" });
    return { error: "failed" };
  }
}

export async function sendTeacherWelcome(data: {
  to: string;
  fullName: string;
  magicLink: string;
  yearsExperience?: number;
}) {
  const resend = getResend();
  if (!resend) {
    logWarn("RESEND_API_KEY not set — skipping teacher application email", { tag: "email" });
    return { error: "no-resend" };
  }
  const safeName = escapeHtml(data.fullName);
  const safeLink = escapeHtml(data.magicLink);
  try {
    await resend.emails.send({
      from: `FURQAN Academy <${FROM_EMAIL}>`,
      to: data.to,
      subject: "تم استلام طلبك في فرقان أكاديمي — قيد المراجعة",
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.7;">
          <h2 style="color: #C8A652; margin-bottom: 8px;">أهلاً ${safeName} 👋</h2>
          <p style="color: #444; font-size: 15px;"><strong>تم استلام طلبك بنجاح.</strong></p>
          <div style="background: #FFF8E7; border-right: 4px solid #C8A652; padding: 14px 18px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0; color: #6B5825;">
              📋 طلبك الآن <strong>قيد مراجعة فريق الإشراف</strong>.<br>
              عادةً ما تكتمل المراجعة خلال <strong>٤٨ ساعة</strong>، وستصلك رسالة تأكيد بمجرد قبول طلبك.
            </p>
          </div>
          <p style="color: #444;">يمكنك تسجيل الدخول إلى لوحة المعلم لمتابعة حالة الطلب وتحديث بياناتك:</p>
          <p style="margin: 24px 0;">
            <a href="${safeLink}" style="display: inline-block; padding: 12px 24px; background: #C8A652; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">دخول لوحة المعلم</a>
          </p>
          <p style="color: #888; font-size: 13px;">إذا لم يعمل الزر، انسخ هذا الرابط:<br><span style="word-break: break-all;">${safeLink}</span></p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
          <p style="margin-top: 24px; font-size: 12px; color: #999;">— أكاديمية فُرقان | furqan.today</p>
        </div>
      `,
    });
    return { success: true };
  } catch (error) {
    logError("Failed to send teacher application email", error, { tag: "email" });
    return { error: "failed" };
  }
}

export async function sendTeacherApprovalEmail(data: {
  to: string;
  fullName: string;
  listingUrl: string;
}) {
  const resend = getResend();
  if (!resend) {
    logWarn("RESEND_API_KEY not set — skipping teacher approval email", { tag: "email" });
    return { error: "no-resend" };
  }
  const safeName = escapeHtml(data.fullName);
  const safeLink = escapeHtml(data.listingUrl);
  try {
    await resend.emails.send({
      from: `FURQAN Academy <${FROM_EMAIL}>`,
      to: data.to,
      subject: "🎉 أهلاً بك معلماً في فرقان أكاديمي",
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.7;">
          <h2 style="color: #2E7D5B; margin-bottom: 8px;">مبارك ${safeName} 🎉</h2>
          <p style="color: #444; font-size: 16px;"><strong>تم قبول طلبك. أنت الآن معلم رسمي في أكاديمية فُرقان.</strong></p>
          <div style="background: #E8F5EE; border-right: 4px solid #2E7D5B; padding: 14px 18px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0; color: #1F5A41;">
              ✨ ملفك الآن مرئي للطلاب على صفحة المعلمين، وبإمكانهم حجز جلسات معك مباشرة.
            </p>
          </div>
          <p style="color: #444;">شاهد ملفك العام:</p>
          <p style="margin: 24px 0;">
            <a href="${safeLink}" style="display: inline-block; padding: 12px 28px; background: #2E7D5B; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">عرض ملفك في صفحة المعلمين</a>
          </p>
          <p style="color: #444; margin-top: 32px;">من لوحة المعلم يمكنك إضافة أوقات الإتاحة وإكمال بياناتك:</p>
          <p style="margin: 12px 0;">
            <a href="https://www.furqan.today/teacher/dashboard" style="color: #C8A652; text-decoration: underline; font-size: 14px;">دخول لوحة المعلم ←</a>
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
          <p style="margin-top: 24px; font-size: 12px; color: #999;">— أكاديمية فُرقان | furqan.today</p>
        </div>
      `,
    });
    return { success: true };
  } catch (error) {
    logError("Failed to send teacher approval email", error, { tag: "email" });
    return { error: "failed" };
  }
}

export async function sendContactNotification(data: {
  fullName: string;
  email: string;
  whatsapp?: string;
  country?: string;
  studentAge?: string;
  packageInterest?: string;
  message?: string;
}) {
  const resend = getResend();
  if (!resend) {
    logWarn("RESEND_API_KEY not set — skipping email notification", { tag: "email" });
    return { error: "مفتاح البريد غير مُعدّ" };
  }

  const safeName = escapeHtml(data.fullName);
  const safeEmail = escapeHtml(data.email);
  const safeWhatsapp = data.whatsapp ? escapeHtml(data.whatsapp) : "";
  const safeCountry = data.country ? escapeHtml(data.country) : "";
  const safeAge = data.studentAge ? escapeHtml(data.studentAge) : "";
  const safePackage = data.packageInterest ? escapeHtml(data.packageInterest) : "";
  const safeMessage = data.message ? escapeHtml(data.message) : "";

  try {
    await resend.emails.send({
      from: `FURQAN Academy <${FROM_EMAIL}>`,
      to: ADMIN_EMAIL,
      subject: `📩 رسالة جديدة من ${sanitizeHeaderValue(data.fullName)}`,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #C8A652;">رسالة جديدة من موقع فُرقان</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">الاسم:</td><td style="padding: 8px;">${safeName}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">البريد:</td><td style="padding: 8px;"><a href="mailto:${safeEmail}">${safeEmail}</a></td></tr>
            ${data.whatsapp ? `<tr><td style="padding: 8px; font-weight: bold; color: #666;">واتساب:</td><td style="padding: 8px;">${safeWhatsapp}</td></tr>` : ""}
            ${data.country ? `<tr><td style="padding: 8px; font-weight: bold; color: #666;">الدولة:</td><td style="padding: 8px;">${safeCountry}</td></tr>` : ""}
            ${data.studentAge ? `<tr><td style="padding: 8px; font-weight: bold; color: #666;">عمر الطالب:</td><td style="padding: 8px;">${safeAge}</td></tr>` : ""}
            ${data.packageInterest ? `<tr><td style="padding: 8px; font-weight: bold; color: #666;">الباقة:</td><td style="padding: 8px;">${safePackage}</td></tr>` : ""}
          </table>
          ${data.message ? `<div style="margin-top: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px;"><p style="font-weight: bold; color: #666;">الرسالة:</p><p>${safeMessage}</p></div>` : ""}
          <p style="margin-top: 24px; font-size: 12px; color: #999;">— أكاديمية فُرقان | furqan.today</p>
        </div>
      `,
    });
    return { success: true };
  } catch (error) {
    logError("Failed to send email", error, { tag: "email" });
    return { error: "فشل إرسال البريد" };
  }
}
