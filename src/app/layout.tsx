import type { Metadata } from "next";
import { Amiri, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const amiri = Amiri({
  variable: "--font-display",
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
  display: "swap",
});

const body = IBM_Plex_Sans_Arabic({
  variable: "--font-body",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "فرقان — أكاديمية القرآن الكريم",
    template: "%s | فرقان",
  },
  description:
    "تعلّم القرآن الكريم مع معلمين متخصصين عبر الإنترنت — حفظ وتجويد وتلاوة. انضم إلى آلاف الطلاب من حول العالم.",
  keywords: ["Quran", "Hifz", "Tajweed", "Online Quran Academy", "فرقان", "حفظ القرآن", "تجويد"],
  openGraph: {
    title: "فرقان — أكاديمية القرآن الكريم",
    description: "تعلّم القرآن مع أمهر المعلمين عبر الإنترنت",
    locale: "ar_AR",
    type: "website",
  },
};

/**
 * Root layout component that renders the application's top-level HTML and BODY elements configured for Arabic (right-to-left) content and theme fonts.
 *
 * @param children - React nodes to be rendered inside the document body
 * @returns The top-level `<html lang="ar" dir="rtl">` element with font CSS variables applied and a `<body>` that wraps `children`
 */
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
