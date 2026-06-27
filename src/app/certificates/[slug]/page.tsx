// Spec 031 — public shareable certificate page.
// Server Component — no client JS needed, no session required.
// Auth: unguessable slug = capability URL. Unknown slug → 404.
// noindex: share link is intentional, but we don't want search-engine enumeration.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import QRCode from "qrcode";

import { getPublicCertificate } from "@/lib/domains/certificates/view";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const cert = await getPublicCertificate(slug);
  if (!cert) return { title: "شهادة | فرقان" };

  return {
    title: `شهادة ${cert.display_name ?? ""} | فرقان`,
    robots: { index: false, follow: false },
  };
}

export default async function CertificatePage({ params }: Props) {
  const { slug } = await params;
  const cert = await getPublicCertificate(slug);
  if (!cert) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://furqan.today";
  const certUrl = `${appUrl}/certificates/${cert.public_slug}`;
  const pdfUrl = `/api/certificates/pdf/${cert.public_slug}`;

  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = await QRCode.toDataURL(certUrl, { width: 160, margin: 1 });
  } catch {
    // QR is best-effort; page renders without it
  }

  const issuedDate = new Date(cert.issued_at).toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const title = certTitle(cert.certificate_type, cert.milestone_key);
  const rangeText = rangeDisplay(cert);

  return (
    <main
      dir="rtl"
      lang="ar"
      className="min-h-screen bg-amber-50 flex items-center justify-center p-6"
    >
      {/* noindex via generateMetadata robots above */}
      <div className="w-full max-w-2xl">
        <div className="border-4 border-double border-amber-600 rounded-xl p-12 bg-white shadow-lg text-center">
          {/* Branding */}
          <p className="text-xs tracking-widest text-gray-400 mb-1">
            منصة فرقان للحفظ القرآني
          </p>
          <p className="text-3xl font-bold text-amber-600 mb-8">فرقان</p>

          {/* Preamble */}
          <p className="text-sm text-gray-500 mb-3">يُشهد بأن</p>
          <h1 className="text-3xl font-bold text-gray-900 mb-4 leading-relaxed">
            {cert.display_name ?? "—"}
          </h1>
          <p className="text-sm text-gray-500 mb-3">قد أتمّ بنجاح</p>

          {/* Certificate title */}
          <h2 className="text-xl font-bold text-amber-700 mb-2">{title}</h2>

          {/* Surah range (null for course_completion) */}
          {rangeText && (
            <p className="text-sm text-gray-600 mb-6">{rangeText}</p>
          )}

          <hr className="border-amber-200 my-6" />

          {/* Date */}
          <p className="text-xs text-gray-400">تاريخ الإصدار</p>
          <p className="text-base text-gray-700 mt-1">{issuedDate}</p>

          {/* QR code */}
          {qrDataUrl && (
            <div className="mt-6 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR code للتحقق من الشهادة" width={120} height={120} />
            </div>
          )}

          {/* Download button */}
          <div className="mt-6">
            <a
              href={pdfUrl}
              className="inline-block bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              تحميل الشهادة PDF
            </a>
          </div>

          <p className="mt-4 text-xs text-gray-300 break-all">{certUrl}</p>
        </div>
      </div>
    </main>
  );
}

function certTitle(
  type: "appreciation_juz" | "appreciation_level" | "course_completion",
  key: string,
): string {
  switch (type) {
    case "appreciation_juz":
      return `حفظ الجزء ${key}`;
    case "appreciation_level":
      return `المستوى ${key}`;
    case "course_completion":
      return "إتمام الدورة";
  }
}

function rangeDisplay(cert: {
  certificate_type: string;
  cited_range_start: string;
  cited_range_end: string;
  cited_start_surah_ar: string | null;
  cited_end_surah_ar: string | null;
}): string | null {
  if (cert.certificate_type === "course_completion") return null;
  if (!cert.cited_range_start && !cert.cited_range_end) return null;

  const startSurah = cert.cited_start_surah_ar ?? cert.cited_range_start.split(":")[0];
  const endSurah = cert.cited_end_surah_ar ?? cert.cited_range_end.split(":")[0];
  const startAyah = cert.cited_range_start.split(":")[1] ?? "";
  const endAyah = cert.cited_range_end.split(":")[1] ?? "";

  if (startSurah === endSurah) {
    return `سورة ${startSurah} — الآيات ${startAyah} إلى ${endAyah}`;
  }
  return `من سورة ${startSurah} (${startAyah}) إلى سورة ${endSurah} (${endAyah})`;
}
