import { ImageResponse } from "next/og";

// Latin-only OG card. @vercel/og's Bidi pipeline crashes uncatchably on
// certain Arabic GSUB lookup tables (see src/app/opengraph-image.tsx). The
// brand is "FURQAN" in Latin; this avoids the streaming-throw class entirely.
export const alt = "FURQAN — Quran Memorization Plans";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 86400;

const baseStyle = {
  background: "#0F0F0F",
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  padding: "60px",
};

export default async function Image() {
  return new ImageResponse(
    (
      <div style={baseStyle}>
        <div style={{ fontSize: 88, fontWeight: "bold", color: "#C8A652", letterSpacing: -2 }}>
          FURQAN
        </div>
        <div style={{ fontSize: 34, color: "#ffffff", marginTop: 20, textAlign: "center" }}>
          Quran Memorization Plans
        </div>
        <div style={{ fontSize: 22, color: "#888888", marginTop: 14, textAlign: "center", maxWidth: 820 }}>
          Monthly subscriptions with certified Ijazah-holding teachers
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
          furqan.today/pricing
        </div>
      </div>
    ),
    { ...size },
  );
}
