import { Resend } from "resend";
import { logError, logWarn } from "@/lib/logger";

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
  const reviewUrl = `https://furqan.today/admin/teachers/cv/${encodeURIComponent(data.teacherId)}`;
  try {
    await resend.emails.send({
      from: `FURQAN Academy <${FROM_EMAIL}>`,
      to: ADMIN_EMAIL,
      subject: `🆕 طلب تدريس جديد — ${data.fullName}`,
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
    logWarn("RESEND_API_KEY not set — skipping teacher welcome email", { tag: "email" });
    return { error: "no-resend" };
  }
  const safeName = escapeHtml(data.fullName);
  const safeLink = escapeHtml(data.magicLink);
  try {
    await resend.emails.send({
      from: `FURQAN Academy <${FROM_EMAIL}>`,
      to: data.to,
      subject: "أهلاً بك في فرقان أكاديمي — رابط دخول حسابك",
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #C8A652;">أهلاً ${safeName} 👋</h2>
          <p>تم استلام طلب التدريس في أكاديمية فُرقان. اضغط على الرابط أدناه لتسجيل الدخول إلى لوحة المعلم وإكمال ملفك:</p>
          <p style="margin: 24px 0;">
            <a href="${safeLink}" style="display: inline-block; padding: 12px 24px; background: #C8A652; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">دخول لوحة المعلم</a>
          </p>
          <p style="color: #666; font-size: 14px;">إذا لم يعمل الزر، انسخ هذا الرابط:<br><span style="word-break: break-all;">${safeLink}</span></p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
          <p style="font-size: 13px; color: #666;">سيقوم فريق الإشراف بمراجعة طلبك قريباً، وستصلك إشعارات عبر البريد ولوحة المعلم.</p>
          <p style="margin-top: 24px; font-size: 12px; color: #999;">— أكاديمية فُرقان | furqan.today</p>
        </div>
      `,
    });
    return { success: true };
  } catch (error) {
    logError("Failed to send teacher welcome email", error, { tag: "email" });
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
      subject: `📩 رسالة جديدة من ${data.fullName}`,
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
