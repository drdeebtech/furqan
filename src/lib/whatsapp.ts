/**
 * Send WhatsApp notification via Callmebot API.
 * Each recipient number needs its own API key from callmebot.com.
 *
 * Setup: Send "I allow callmebot to send me messages" to +34 644 71 88 74
 * Then add the API key to env vars.
 */

import { logError, logWarn } from "@/lib/logger";

interface WhatsAppRecipient {
  phone: string;
  apiKey: string | undefined;
}

function getRecipients(): WhatsAppRecipient[] {
  return [
    { phone: process.env.CALLMEBOT_PHONE_KW ?? "", apiKey: process.env.CALLMEBOT_KEY_KW },
    { phone: process.env.CALLMEBOT_PHONE_EG ?? "", apiKey: process.env.CALLMEBOT_KEY_EG },
  ].filter(r => r.apiKey && r.phone);
}

export async function sendWhatsAppNotification(message: string) {
  const recipients = getRecipients();
  if (recipients.length === 0) {
    logWarn("WhatsApp: no recipients configured — check CALLMEBOT_KEY_KW / CALLMEBOT_KEY_EG env vars", { tag: "whatsapp" });
    return;
  }

  const encoded = encodeURIComponent(message);

  const results = await Promise.allSettled(
    recipients.map(async r => {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${r.phone}&text=${encoded}&apikey=${r.apiKey}`;
      const res = await fetch(url);
      const text = await res.text();
      if (!text.includes("queued")) {
        logError(`WhatsApp failed for ${r.phone}`, new Error(text), { tag: "whatsapp", phone: r.phone });
      }
      return text;
    }),
  );

  for (const r of results) {
    if (r.status === "rejected") {
      logError("WhatsApp send failed", r.reason, { tag: "whatsapp" });
    }
  }
}

// Pre-formatted notification helpers
export async function notifyNewBooking(studentName: string, teacherName: string, date: string) {
  await sendWhatsAppNotification(
    `📅 حجز جديد في فُرقان\n\nالطالب: ${studentName}\nالمعلم: ${teacherName}\nالموعد: ${date}\n\nيرجى مراجعة لوحة التحكم.`,
  );
}

export async function notifyNewContact(name: string, email: string, packageInterest?: string) {
  await sendWhatsAppNotification(
    `📩 رسالة جديدة من موقع فُرقان\n\nالاسم: ${name}\nالبريد: ${email}${packageInterest ? `\nالباقة: ${packageInterest}` : ""}\n\nراجع /admin/contacts`,
  );
}

export async function notifyNewUser(name: string, role: string) {
  await sendWhatsAppNotification(
    `👤 مستخدم جديد في فُرقان\n\nالاسم: ${name}\nالدور: ${role}`,
  );
}

export async function notifySessionStarted(studentName: string, teacherName: string) {
  await sendWhatsAppNotification(
    `🎥 جلسة بدأت الآن\n\nالطالب: ${studentName}\nالمعلم: ${teacherName}`,
  );
}

export async function notifyNewTeacherApplication(name: string, country: string, specialties: string[]) {
  await sendWhatsAppNotification(
    `🆕 طلب انضمام معلم جديد\n\nالاسم: ${name}\nالبلد: ${country}\nالتخصصات: ${specialties.join("، ")}\n\nراجع /admin/teachers`,
  );
}
