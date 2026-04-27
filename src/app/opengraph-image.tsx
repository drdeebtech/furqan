import { ImageResponse } from "next/og";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const revalidate = 3600;
export const alt = "FURQAN — Quran Academy";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Site-wide OG card.
 *
 * Wrapped in try/catch + Latin-only fallback because @vercel/og's Bidi
 * pipeline crashes with `lookupType: 5 - substFormat: 3 is not yet
 * supported` on certain Arabic GSUB feature lookup tables (Sentry issue
 * NEXTJS-3, hit 6+ events from real social-bot crawls). The primary
 * render keeps the Arabic for when it works; the fallback drops Arabic
 * entirely so it can never re-throw.
 */
export default async function Image() {
  try {
    return renderPrimary();
  } catch (err) {
    logError("Root OG image render threw — falling back to Latin", err, {
      component: "root.opengraph-image",
      tag: "og-image",
    });
    return renderFallbackLatin();
  }
}

function renderPrimary() {
  return new ImageResponse(
    (
      <div style={baseStyle}>
        <div style={{ fontSize: 80, fontWeight: "bold", color: "#C8A652", marginBottom: 20 }}>
          فُرقان
        </div>
        <div style={{ fontSize: 32, color: "#ffffff", marginBottom: 16, textAlign: "center" }}>
          FURQAN Quran Academy
        </div>
        <div style={{ fontSize: 22, color: "#888888", textAlign: "center", maxWidth: 800 }}>
          Learn Quran with Certified Teachers · تعلّم القرآن مع معلمين معتمدين
        </div>
        <div
          style={{
            marginTop: 40,
            background: "#C8A652",
            color: "#0F0F0F",
            padding: "12px 32px",
            borderRadius: 50,
            fontSize: 20,
            fontWeight: "bold",
          }}
        >
          furqan.today
        </div>
      </div>
    ),
    { ...size },
  );
}

function renderFallbackLatin() {
  return new ImageResponse(
    (
      <div style={baseStyle}>
        <div style={{ fontSize: 96, fontWeight: "bold", color: "#C8A652", letterSpacing: -2 }}>
          FURQAN
        </div>
        <div style={{ fontSize: 32, color: "#ffffff", marginTop: 24, textAlign: "center" }}>
          Quran Academy
        </div>
        <div style={{ fontSize: 22, color: "#888", marginTop: 16, textAlign: "center", maxWidth: 800 }}>
          Learn Quran with Certified Teachers
        </div>
        <div
          style={{
            marginTop: 40,
            background: "#C8A652",
            color: "#0F0F0F",
            padding: "12px 32px",
            borderRadius: 50,
            fontSize: 20,
            fontWeight: "bold",
          }}
        >
          furqan.today
        </div>
      </div>
    ),
    { ...size },
  );
}

const baseStyle = {
  background: "#0F0F0F",
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
};
