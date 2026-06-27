import "server-only";

import fs from "node:fs";
import path from "node:path";

import QRCode from "qrcode";

import { logError } from "@/lib/logger";
import { buildCertHtml } from "./cert-html";
import type { PublicCertificate } from "./view";

/**
 * Render a certificate as a PDF buffer.
 *
 * Uses puppeteer-core + @sparticuz/chromium (serverless-safe headless Chrome).
 * Bundles the Amiri Arabic Naskh font from public/fonts/Amiri-Regular.ttf so
 * Arabic ligatures shape correctly — the #1 risk called out in spec 031.
 *
 * Returns a Buffer whose first four bytes are %PDF.
 * Throws on launch failure, render failure, or missing chromium.
 */
export async function renderCertificatePdf(cert: PublicCertificate): Promise<Buffer> {
  // Dynamic imports so the large binaries are not pulled into edge bundles.
  const [puppeteer, chromium] = await Promise.all([
    import("puppeteer-core"),
    import("@sparticuz/chromium"),
  ]);

  const fontBase64 = loadArabicFont();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://furqan.today";
  const certUrl = `${appUrl}/certificates/${cert.public_slug}`;
  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = await QRCode.toDataURL(certUrl, { width: 160, margin: 1 });
  } catch (err) {
    logError("renderCertificatePdf: QR generation failed (non-fatal)", err, {
      tag: "cert_pdf",
    });
  }

  const html = buildCertHtml(cert, { fontBase64, qrDataUrl, appUrl });

  const executablePath = await chromium.default.executablePath();
  const browser = await puppeteer.default.launch({
    args: chromium.default.args,
    executablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    // Wait for Arabic font to finish loading before rendering.
    await page.evaluate(() => document.fonts.ready);

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

/** Read Amiri font as base64. Returns null if not found — caller falls back to system font. */
function loadArabicFont(): string | null {
  const fontPath = path.join(process.cwd(), "public", "fonts", "Amiri-Regular.ttf");
  try {
    const bytes = fs.readFileSync(fontPath);
    return bytes.toString("base64");
  } catch {
    logError(
      "renderCertificatePdf: Amiri font not found — Arabic will use system fallback. " +
        "Run scripts/download-arabic-font.sh to fix.",
      null,
      { tag: "cert_pdf" },
    );
    return null;
  }
}
