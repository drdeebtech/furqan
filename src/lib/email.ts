import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "drdeebtech@gmail.com";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
      subject: `📩 رسالة جديدة من ${safeName}`,
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
    console.error("Failed to send email:", error);
    return { error: "فشل إرسال البريد" };
  }
}
