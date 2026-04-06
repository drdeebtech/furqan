/**
 * Send WhatsApp notification via Callmebot API.
 * Each recipient number needs its own API key from callmebot.com.
 *
 * Setup: Send "I allow callmebot to send me messages" to +34 644 71 88 74
 * Then add the API key to env vars.
 */

interface WhatsAppRecipient {
  phone: string;
  apiKey: string | undefined;
}

function getRecipients(): WhatsAppRecipient[] {
  return [
    { phone: "96598759229", apiKey: process.env.CALLMEBOT_KEY_KW },
    { phone: "201220210300", apiKey: process.env.CALLMEBOT_KEY_EG },
  ].filter(r => r.apiKey);
}

export async function sendWhatsAppNotification(message: string) {
  const recipients = getRecipients();
  if (recipients.length === 0) return;

  const encoded = encodeURIComponent(message);

  await Promise.allSettled(
    recipients.map(r =>
      fetch(`https://api.callmebot.com/whatsapp.php?phone=${r.phone}&text=${encoded}&apikey=${r.apiKey}`)
        .catch(() => {}) // non-blocking
    ),
  );
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
