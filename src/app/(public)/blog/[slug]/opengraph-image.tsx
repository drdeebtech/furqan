import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";

export const runtime = "edge";
export const alt = "فرقان — مقال";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: post } = await supabase
    .from("blog_posts")
    .select("title_ar, category_ar")
    .eq("slug", slug)
    .eq("is_published", true)
    .single<{ title_ar: string; category_ar: string }>();

  const title = post?.title_ar ?? "مقال";
  const category = post?.category_ar ?? "";

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
          padding: "60px",
        }}
      >
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
