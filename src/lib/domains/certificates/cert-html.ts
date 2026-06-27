// One layout source of truth for the certificate.
// Both the PDF renderer (pdf.ts) and the public page (page.tsx) derive
// their content from this function so design stays in sync.
//
// Returns a complete standalone HTML document suitable for puppeteer
// page.setContent(). The font is embedded as a base64 data URL so no
// network request is needed during headless rendering.

import type { PublicCertificate } from "./view";

interface BuildOptions {
  /** Base64-encoded TTF bytes of the Arabic font (Amiri). Null → system fallback. */
  fontBase64: string | null;
  /** QR code as a data URL (PNG). Null → QR omitted. */
  qrDataUrl: string | null;
  /** App origin for branding/verification text. */
  appUrl: string;
}

export function buildCertHtml(
  cert: PublicCertificate,
  { fontBase64, qrDataUrl, appUrl }: BuildOptions,
): string {
  const fontFace = fontBase64
    ? `@font-face {
        font-family: 'Amiri';
        src: url('data:font/truetype;base64,${fontBase64}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }`
    : "";

  const arabicFamily = fontBase64 ? "'Amiri', " : "";
  const family = `${arabicFamily}Arial, sans-serif`;

  const title = certTitle(cert);
  const rangeText = rangeDisplay(cert);
  const issuedDate = new Date(cert.issued_at).toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const verifyUrl = `${appUrl}/certificates/${cert.public_slug}`;

  const qrBlock = qrDataUrl
    ? `<div class="qr"><img src="${qrDataUrl}" alt="QR code للتحقق" width="120" height="120" /></div>`
    : "";

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>شهادة | فرقان</title>
  <style>
    ${fontFace}
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ${family};
      background: #fff;
      color: #1a1a1a;
      direction: rtl;
      text-align: center;
      padding: 40px;
    }
    .cert {
      border: 4px double #b8860b;
      border-radius: 12px;
      padding: 48px 40px;
      max-width: 680px;
      margin: 0 auto;
      background: linear-gradient(135deg, #fffdf4 0%, #fff 100%);
    }
    .brand {
      font-size: 13px;
      letter-spacing: 0.1em;
      color: #888;
      margin-bottom: 8px;
    }
    .logo-text {
      font-size: 28px;
      font-weight: bold;
      color: #b8860b;
      margin-bottom: 24px;
    }
    .preamble {
      font-size: 14px;
      color: #555;
      margin-bottom: 12px;
    }
    .name {
      font-size: 30px;
      font-weight: bold;
      color: #1a1a1a;
      margin: 16px 0;
      line-height: 1.4;
    }
    .cert-title {
      font-size: 20px;
      color: #b8860b;
      margin: 16px 0 8px;
      font-weight: bold;
    }
    .range {
      font-size: 15px;
      color: #444;
      margin-bottom: 24px;
    }
    .divider {
      border: none;
      border-top: 1px solid #e8d9a0;
      margin: 24px 0;
    }
    .date-label { font-size: 12px; color: #888; }
    .date { font-size: 16px; color: #333; margin-top: 4px; }
    .verify {
      font-size: 11px;
      color: #aaa;
      margin-top: 20px;
      word-break: break-all;
    }
    .qr {
      margin: 20px auto 0;
    }
    .qr img { display: block; margin: 0 auto; }
  </style>
</head>
<body>
  <div class="cert">
    <div class="brand">منصة فرقان للحفظ القرآني</div>
    <div class="logo-text">فرقان</div>
    <p class="preamble">يُشهد بأن</p>
    <div class="name">${escapeHtml(cert.display_name ?? "—")}</div>
    <p class="preamble">قد أتمّ بنجاح</p>
    <div class="cert-title">${escapeHtml(title)}</div>
    ${rangeText ? `<div class="range">${escapeHtml(rangeText)}</div>` : ""}
    <hr class="divider" />
    <div class="date-label">تاريخ الإصدار</div>
    <div class="date">${escapeHtml(issuedDate)}</div>
    ${qrBlock}
    <div class="verify">للتحقق: ${escapeHtml(verifyUrl)}</div>
  </div>
</body>
</html>`;
}

function certTitle(cert: PublicCertificate): string {
  switch (cert.certificate_type) {
    case "appreciation_juz":
      return `حفظ الجزء ${cert.milestone_key}`;
    case "appreciation_level":
      return `المستوى ${cert.milestone_key}`;
    case "course_completion":
      return `إتمام الدورة`;
  }
}

function rangeDisplay(cert: PublicCertificate): string {
  if (cert.certificate_type === "course_completion") return "";
  if (!cert.cited_range_start || !cert.cited_range_end) return "";

  const startSurah = cert.cited_start_surah_ar ?? cert.cited_range_start.split(":")[0];
  const endSurah = cert.cited_end_surah_ar ?? cert.cited_range_end.split(":")[0];
  const startAyah = cert.cited_range_start.split(":")[1] ?? "";
  const endAyah = cert.cited_range_end.split(":")[1] ?? "";

  if (startSurah === endSurah) {
    return `سورة ${startSurah} — الآيات ${startAyah} إلى ${endAyah}`;
  }
  return `من سورة ${startSurah} (${startAyah}) إلى سورة ${endSurah} (${endAyah})`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
