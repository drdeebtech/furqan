import { ImageResponse } from "next/og";

export const dynamic = "force-dynamic";
export const revalidate = 3600;
export const alt = "FURQAN — Quran Academy";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Site-wide OG card — Latin only.
 *
 * The previous version included Arabic text ("فُرقان" + tashkīl) which
 * triggered @vercel/og's Bidi pipeline. That pipeline crashes during the
 * RESPONSE STREAM (not the synchronous constructor) with `lookupType: 5
 * - substFormat: 3 is not yet supported` on certain Arabic GSUB lookup
 * tables. A wrapping try/catch can't catch a throw that happens after
 * the function returns and inside the streaming pipe — Sentry caught
 * the same error class fire AGAIN (NEXTJS-9) on commit 4a1ca06 with
 * the try/catch in place.
 *
 * This version drops Arabic from the OG card entirely. The brand is
 * already "FURQAN" in Latin; the Arabic was decorative. Reliability
 * over decoration. The blog OG (src/app/(public)/blog/[slug]/opengraph-image.tsx)
 * has its own try/catch + Latin fallback for the title-throw case.
 *
 * If you ever want Arabic back here: bundle a font with simpler GSUB
 * lookup tables (Cairo / Noto Sans Arabic) via ImageResponse({ fonts }).
 * The system fallback font has the unsupported lookup-type-5 substitutions.
 */
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#0F0F0F",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
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
