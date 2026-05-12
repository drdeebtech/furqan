import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Inter, Rakkas, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/context";
import { ToastProvider } from "@/components/shared/toast";
import { PwaInstallPrompt } from "@/components/shared/pwa-install-prompt";
import { PreviewDeploymentBanner } from "@/components/shared/preview-deployment-banner";
import { HydrationBeacon } from "@/components/shared/hydration-beacon";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

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
  // WCAG 2.5.5: do not disable user zoom. Allow up to 5x for low-vision users.
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0F0F0F" },
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://www.furqan.today"),
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
  authors: [{ name: "FURQAN Academy", url: "https://www.furqan.today" }],
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
    locale: "ar_SA",
    alternateLocale: ["en_US"],
    url: "https://www.furqan.today",
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
    canonical: "https://www.furqan.today",
    // `x-default` tells Google the canonical URL for users whose preferred
    // language isn't specified. We keep the same origin for both locales but
    // distinguish via the `?lang=` query so crawlers can pick up both variants.
    languages: {
      ar: "https://www.furqan.today/?lang=ar",
      en: "https://www.furqan.today/?lang=en",
      "x-default": "https://www.furqan.today",
    },
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the persisted language cookie so `<html lang>` and `dir` match the
  // user's choice on the first byte — important for screen readers and for
  // search engines that don't execute JS.
  const cookieStore = await cookies();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const langCookie = cookieStore.get("furqan-lang")?.value;
  const lang: "ar" | "en" = langCookie === "en" ? "en" : "ar";
  const dir = lang === "ar" ? "rtl" : "ltr";

  return (
    <html
      lang={lang}
      dir={dir}
      className={`${inter.variable} ${rakkas.variable} ${body.variable} h-full antialiased`}
    >
      <head>
        <script src="/sw-register.js" defer nonce={nonce} />
      </head>
      <body className="min-h-full flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-0 focus:start-0 focus:z-[9999] focus:w-full focus:bg-gold focus:px-4 focus:py-3 focus:text-center focus:text-sm focus:font-medium focus:text-white"
        >
          {lang === "ar" ? "تخطي إلى المحتوى" : "Skip to main content"}
        </a>
        <PreviewDeploymentBanner />
        <ThemeProvider>
          <ToastProvider>
            {children}
            <PwaInstallPrompt />
          </ToastProvider>
        </ThemeProvider>
        <HydrationBeacon />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
