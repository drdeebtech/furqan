import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Public acquisition surfaces are explicitly allowed (clearer than
        // relying on the default-allow of "/"). /subscribe is intentionally
        // omitted: it is auth-gated and noindex (see src/app/subscribe/page.tsx).
        allow: [
          "/",
          "/about",
          "/services",
          "/pricing",
          "/teachers",
          "/courses",
          "/courses/*",
          "/teach-with-us",
          "/blog",
          "/blog/*",
          "/help",
          "/help/*",
          "/contact",
        ],
        disallow: ["/student/", "/teacher/", "/admin/", "/api/", "/login", "/register", "/subscribe"],
      },
      { userAgent: "GPTBot", allow: ["/", "/about", "/services", "/blog/*"] },
      { userAgent: "Claude-Web", allow: ["/", "/about", "/services", "/blog/*"] },
      { userAgent: "PerplexityBot", allow: ["/"] },
      { userAgent: "anthropic-ai", allow: ["/"] },
      { userAgent: "CCBot", allow: ["/"] },
    ],
    sitemap: "https://www.furqan.today/sitemap.xml",
    host: "https://www.furqan.today",
  };
}
