import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import type { Course } from "@/types/database";

export const alt = "FURQAN — Quran Course";
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

/**
 * Course OG image. Prefers the course cover image (a raster — no font risk)
 * and an English title overlay. We deliberately avoid rendering DB Arabic
 * (title_ar, teacher name) because @vercel/og's Bidi pipeline crashes
 * uncatchably on certain Arabic GSUB lookups (see src/app/opengraph-image.tsx).
 * Missing slug / course / cover → safe Latin branded fallback.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  try {
    // admin: public OG image generation; anonymous read (issue #523)
    const supabase = createAdminClient();
    const { data: course } = await supabase
      .from("courses")
      .select("title_en, cover_image_url")
      .eq("slug", slug)
      .eq("status", "published")
      .single<Pick<Course, "title_en" | "cover_image_url">>();

    if (!course) return renderFallback();
    return renderCourse(course.title_en, course.cover_image_url);
  } catch (err) {
    logError("OG image render threw", err, {
      component: "courses.opengraph-image",
      tag: "og-image",
      metadata: { slug },
    });
    return renderFallback();
  }
}

function renderCourse(titleEn: string | null, coverUrl: string | null) {
  // Cover-image background variant: the raster carries the visual context,
  // a gradient scrim keeps the Latin title legible.
  if (coverUrl) {
    return new ImageResponse(
      (
        <div style={{ ...baseStyle, padding: 0, position: "relative", justifyContent: "flex-end" }}>
          <img
            src={coverUrl}
            alt=""
            width={size.width}
            height={size.height}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              background: "linear-gradient(180deg, rgba(15,15,15,0.1) 0%, rgba(15,15,15,0.85) 100%)",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", padding: "60px", zIndex: 1 }}>
            <div style={{ fontSize: 26, fontWeight: "bold", color: "#C8A652", letterSpacing: -1 }}>FURQAN</div>
            {titleEn && (
              <div style={{ fontSize: 48, fontWeight: "bold", color: "#ffffff", marginTop: 12, maxWidth: 1000 }}>
                {titleEn}
              </div>
            )}
            <div style={{ fontSize: 20, color: "#cccccc", marginTop: 12 }}>furqan.today/courses</div>
          </div>
        </div>
      ),
      { ...size },
    );
  }

  // No cover image: branded Latin card, with English title when present.
  return new ImageResponse(
    (
      <div style={baseStyle}>
        <div style={{ fontSize: 72, fontWeight: "bold", color: "#C8A652", letterSpacing: -2 }}>FURQAN</div>
        <div style={{ fontSize: titleEn ? 40 : 32, color: "#ffffff", marginTop: 20, textAlign: "center", maxWidth: 900 }}>
          {titleEn ?? "Online Quran Course"}
        </div>
        <div style={{ fontSize: 20, color: "#666666", marginTop: 40 }}>furqan.today/courses</div>
      </div>
    ),
    { ...size },
  );
}

function renderFallback() {
  return new ImageResponse(
    (
      <div style={baseStyle}>
        <div style={{ fontSize: 72, fontWeight: "bold", color: "#C8A652", letterSpacing: -2 }}>FURQAN</div>
        <div style={{ fontSize: 32, color: "#ffffff", marginTop: 20, textAlign: "center", maxWidth: 900 }}>
          Online Quran Courses
        </div>
        <div style={{ fontSize: 20, color: "#666666", marginTop: 40 }}>furqan.today/courses</div>
      </div>
    ),
    { ...size },
  );
}
