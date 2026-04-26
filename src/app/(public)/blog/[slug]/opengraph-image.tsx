import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";

export const alt = "فرقان — مقال";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// 24h edge cache. Social-media bots re-request OG images repeatedly when
// the link is shared; serving the same bytes from CDN avoids re-rendering
// (and re-throwing if the slug is bad) on every retry.
export const revalidate = 86400;

/**
 * Render the OG image for a blog post.
 *
 * Wrapped in try/catch so a missing slug, invalid post, or font-loading
 * hiccup never bubbles up as "failed to pipe response" — that error
 * was hitting Sentry every time a social bot crawled an unpublished
 * URL. We now return a generic site-OG fallback (status 200) instead,
 * and only log to Sentry when the throw is genuinely unexpected.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  try {
    const supabase = await createClient();
    const { data: post } = await supabase
      .from("blog_posts")
      .select("title_ar, category_ar")
      .eq("slug", slug)
      .eq("is_published", true)
      .single<{ title_ar: string; category_ar: string }>();

    // Slug not found OR not published → return generic site card. We
    // don't log this; it's expected when bots crawl stale links.
    if (!post) return renderFallback();

    return renderPost(post.title_ar, post.category_ar);
  } catch (err) {
    // Genuinely unexpected — log so we know if something deeper is
    // breaking (font fetch failed, RSC streaming bug, etc).
    logError("OG image render threw", err, {
      component: "blog.opengraph-image",
      tag: "og-image",
      metadata: { slug },
    });
    // Still return a 200 with the fallback so the social preview shows
    // *something* and the bot stops retrying.
    return renderFallback();
  }
}

function renderPost(title: string, category: string) {
  return new ImageResponse(
    (
      <div style={baseStyle}>
        <div style={{ fontSize: 28, color: "#C8A652", marginBottom: 16 }}>
          فُرقان — المدونة
        </div>
        {category && (
          <div
            style={{
              fontSize: 18,
              color: "#888888",
              marginBottom: 24,
              background: "#1a1a1a",
              padding: "6px 20px",
              borderRadius: 50,
            }}
          >
            {category}
          </div>
        )}
        <div
          style={{
            fontSize: 48,
            fontWeight: "bold",
            color: "#ffffff",
            textAlign: "center",
            maxWidth: 900,
            lineHeight: 1.4,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 18, color: "#666666", marginTop: 40 }}>
          furqan.today
        </div>
      </div>
    ),
    { ...size },
  );
}

function renderFallback() {
  return new ImageResponse(
    (
      <div style={baseStyle}>
        <div style={{ fontSize: 64, color: "#C8A652", marginBottom: 24, fontWeight: "bold" }}>
          فُرقان
        </div>
        <div style={{ fontSize: 32, color: "#ffffff", textAlign: "center", maxWidth: 900 }}>
          أكاديمية فرقان لتعليم القرآن الكريم
        </div>
        <div style={{ fontSize: 20, color: "#666666", marginTop: 40 }}>
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
  padding: "60px",
};
