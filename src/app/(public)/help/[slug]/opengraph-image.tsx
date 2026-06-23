import { ImageResponse } from "next/og";

// Help-center OG card. Intentionally static + Latin: help article titles are
// Arabic, and rendering DB Arabic through @vercel/og risks the uncatchable
// Bidi streaming crash documented in src/app/opengraph-image.tsx. A generic
// branded card is the "safe missing-article fallback" required by the spec and
// renders identically (and reliably) for every slug, valid or not.
export const alt = "FURQAN — Help Center";
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
          Help Center
        </div>
        <div style={{ fontSize: 22, color: "#888888", marginTop: 14, textAlign: "center", maxWidth: 820 }}>
          Guides & answers for learners and teachers
        </div>
        <div style={{ fontSize: 20, color: "#666666", marginTop: 40 }}>furqan.today/help</div>
      </div>
    ),
    { ...size },
  );
}
