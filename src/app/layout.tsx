import type { Metadata } from "next";
import { Amiri, Cairo } from "next/font/google";
import "./globals.css";

const amiri = Amiri({
  variable: "--font-display",
  subsets: ["arabic"],
  weight: ["400", "700"],
  display: "swap",
  preload: true,
});

const body = Cairo({
  variable: "--font-body",
  subsets: ["arabic", "latin"],
  display: "swap",
  preload: true,
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  metadataBase: new URL("https://furqan.today"),
  title: {
    default: "فرقان — تعلم القرآن الكريم مع معلمين معتمدين",
    template: "%s | فرقان",
  },
  description:
    "أكاديمية فرقان لتعليم القرآن الكريم عبر الإنترنت. تعلّم الحفظ والتجويد والتلاوة مع معلمين حاصلين على الإجازة. جلسات فيديو مباشرة، جدول مرن. سجّل الآن وابدأ.",
  keywords: [
    "تعلم القرآن اون لاين", "حفظ القرآن", "تجويد القرآن", "معلم قرآن", "أكاديمية قرآن",
    "Quran online academy", "learn Quran online", "Quran memorization", "Tajweed classes",
    "online Quran teacher", "Hifz program", "Quran for kids", "female Quran teacher",
    "furqan academy", "فرقان",
  ],
  authors: [{ name: "FURQAN Academy", url: "https://furqan.today" }],
  creator: "FURQAN Academy",
  publisher: "FURQAN Academy",
  formatDetection: { email: false, address: false, telephone: false },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    locale: "ar_AR",
    alternateLocale: "en_US",
    url: "https://furqan.today",
    siteName: "فرقان — FURQAN Academy",
    title: "فرقان — تعلم القرآن الكريم مع معلمين معتمدين",
    description: "تعلّم الحفظ والتجويد مع معلمين حاصلين على الإجازة. سجّل الآن وابدأ.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "فرقان — أكاديمية القرآن الكريم" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "فرقان — تعلم القرآن الكريم",
    description: "تعلّم الحفظ والتجويد مع معلمين معتمدين. سجّل الآن وابدأ.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-video-preview": -1, "max-image-preview": "large", "max-snippet": -1 },
  },
  alternates: {
    canonical: "https://furqan.today",
    languages: { ar: "https://furqan.today", en: "https://furqan.today" },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${amiri.variable} ${body.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
