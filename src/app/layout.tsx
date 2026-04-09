import type { Metadata, Viewport } from "next";
import { Inter, Rakkas, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/context";
import { PwaInstallPrompt } from "@/components/shared/pwa-install-prompt";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

const rakkas = Rakkas({
  variable: "--font-display",
  subsets: ["arabic", "latin"],
  weight: ["400"],
  display: "swap",
  preload: true,
});

const body = IBM_Plex_Sans_Arabic({
  variable: "--font-body",
  subsets: ["arabic"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  preload: true,
  adjustFontFallback: false,
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0F0F0F" },
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
  ],
};

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
  manifest: "/manifest.json",
  openGraph: {
    type: "website",
    locale: "ar_AR",
    alternateLocale: "en_US",
    url: "https://furqan.today",
    siteName: "فرقان — FURQAN Academy",
    title: "فرقان — تعلم القرآن الكريم مع معلمين معتمدين",
    description: "تعلّم الحفظ والتجويد مع معلمين حاصلين على الإجازة. سجّل الآن وابدأ.",
  },
  twitter: {
    card: "summary_large_image",
    title: "فرقان — تعلم القرآن الكريم",
    description: "تعلّم الحفظ والتجويد مع معلمين معتمدين. سجّل الآن وابدأ.",
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
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "فرقان",
  },
  other: {
    "mobile-web-app-capable": "yes",
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
      className={`${inter.variable} ${rakkas.variable} ${body.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'))}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-0 focus:left-0 focus:z-[9999] focus:w-full focus:bg-gold focus:px-4 focus:py-3 focus:text-center focus:text-sm focus:font-medium focus:text-white"
        >
          تخطي إلى المحتوى
        </a>
        <ThemeProvider>
          {children}
          <PwaInstallPrompt />
        </ThemeProvider>
      </body>
    </html>
  );
}
