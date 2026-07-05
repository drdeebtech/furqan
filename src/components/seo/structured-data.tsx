// JSON-LD structured data for SEO. Some schemas embed DB-sourced text
// (article/course/teacher fields), so every block is serialized via
// `safeJsonLd` — JSON.stringify alone does NOT escape `</script>`, which
// would let stored content break out of the script tag (stored XSS).

import { CONTACT } from "@/lib/contact";

/**
 * Serialize a JSON-LD object for safe embedding in a <script> tag.
 * Escapes `<` to its unicode form so a `</script>` sequence inside any
 * string value cannot terminate the block early and inject markup.
 */
export function safeJsonLd(schema: unknown): string {
  return JSON.stringify(schema).replace(/</g, "\\u003c");
}

export function BreadcrumbSchema({ items }: { items: { name: string; url: string }[] }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }} />;
}

export function OrganizationSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: "فرقان — FURQAN Quran Academy",
    alternateName: "Furqan Academy",
    url: "https://www.furqan.today",
    logo: "https://www.furqan.today/logo-512.png",
    description: "Online Quran academy offering Hifz, Tajweed, and Tilawa with certified teachers holding Ijazah.",
    email: CONTACT.email,
    telephone: "+96597795626",
    address: { "@type": "PostalAddress", addressCountry: "KW", addressLocality: "Kuwait" },
    // NOTE: no top-level `offers` here — a price:"0" "Free Registration" Offer is
    // misleading (sessions are $12–$80/mo) and risks a Google rich-result penalty.
    // The hasOfferCatalog below lists the (non-priced) program catalog, which is valid.
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Quran Learning Programs",
      itemListElement: [
        { "@type": "Offer", itemOffered: { "@type": "Course", name: "Quran Memorization (Hifz)", description: "Structured Quran memorization with certified teachers", provider: { "@type": "Organization", name: "FURQAN Academy" } } },
        { "@type": "Offer", itemOffered: { "@type": "Course", name: "Tajweed Rules", description: "Learn Tajweed for proper Quran recitation", provider: { "@type": "Organization", name: "FURQAN Academy" } } },
        { "@type": "Offer", itemOffered: { "@type": "Course", name: "Quran Recitation", description: "Improve Quran recitation with expert guidance", provider: { "@type": "Organization", name: "FURQAN Academy" } } },
      ],
    },
  };

  // Safe: schema is hardcoded static content, not user-generated
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }} />;
}

export function ArticleSchema({
  headline,
  image,
  datePublished,
  dateModified,
  description,
  url,
}: {
  headline: string;
  image: string;
  datePublished: string;
  dateModified: string;
  description: string;
  url: string;
}) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    image,
    datePublished,
    dateModified,
    description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: {
      "@type": "Organization",
      name: "FURQAN Academy",
      url: "https://www.furqan.today",
    },
    publisher: {
      "@type": "Organization",
      name: "FURQAN Academy",
      logo: { "@type": "ImageObject", url: "https://www.furqan.today/logo-512.png" },
    },
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }} />;
}

export function WebSiteSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "فرقان — FURQAN Quran Academy",
    alternateName: "Furqan Academy",
    url: "https://www.furqan.today",
    inLanguage: ["ar", "en"],
    publisher: { "@type": "Organization", name: "FURQAN Academy", url: "https://www.furqan.today" },
    // No `potentialAction` SearchAction (sitelinks searchbox): the site has no
    // public search endpoint, so emitting a search target would be fabricated.
    // Add it here when a public /search route ships (see spec 027 deferred work).
  };

  // Safe: schema is hardcoded static content, not user-generated.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }} />;
}

// FAQSchema removed: it was rendered site-wide (every public page) with 5 hardcoded
// English Q&As that don't appear in the visible DOM — a FAQPage-policy violation.
// The real visible FAQ on /contact is DB-driven from `site_faqs`. The correct
// replacement is a DYNAMIC FAQPage schema generated from those same `site_faqs`
// rows and rendered only on /contact. Tracked as a follow-up.
