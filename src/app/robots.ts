import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/about", "/services", "/packages", "/teachers", "/blog", "/blog/*", "/contact"],
        disallow: ["/student/", "/teacher/", "/admin/", "/api/", "/login", "/register"],
      },
      { userAgent: "GPTBot", allow: ["/", "/about", "/services", "/blog/*"] },
      { userAgent: "Claude-Web", allow: ["/", "/about", "/services", "/blog/*"] },
      { userAgent: "PerplexityBot", allow: ["/"] },
      { userAgent: "anthropic-ai", allow: ["/"] },
      { userAgent: "CCBot", allow: ["/"] },
    ],
    sitemap: "https://furqan.today/sitemap.xml",
    host: "https://furqan.today",
  };
}
