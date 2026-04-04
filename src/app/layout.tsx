import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "فرقان — أكاديمية القرآن الكريم",
    template: "%s | فرقان",
  },
  description:
    "تعلّم القرآن الكريم مع معلمين متخصصين عبر الإنترنت — حفظ وتجويد وتلاوة. انضم إلى آلاف الطلاب من حول العالم.",
  keywords: [
    "Quran",
    "Hifz",
    "Tajweed",
    "Online Quran Academy",
    "فرقان",
    "حفظ القرآن",
    "تجويد",
  ],
  openGraph: {
    title: "فرقان — أكاديمية القرآن الكريم",
    description: "تعلّم القرآن مع أمهر المعلمين عبر الإنترنت",
    locale: "ar_AR",
    type: "website",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
