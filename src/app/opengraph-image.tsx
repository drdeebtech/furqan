import { ImageResponse } from "next/og";

export const dynamic = "force-dynamic";
export const alt = "فرقان — أكاديمية القرآن الكريم";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
