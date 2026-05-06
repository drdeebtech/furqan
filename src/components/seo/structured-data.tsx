// JSON-LD structured data for SEO — static content only, no user input

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

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
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
    email: "alforqan.egy@gmail.com",
    telephone: "+96597795626",
    address: { "@type": "PostalAddress", addressCountry: "KW", addressLocality: "Kuwait" },
    offers: {
      "@type": "Offer",
      description: "Online Quran lessons",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      name: "Free Registration",
    },
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
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
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

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

export function FAQSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: "How do I register?", acceptedAnswer: { "@type": "Answer", text: "Create a free account on the platform, then choose your teacher and book your first session. Registration is easy and takes less than a minute." } },
      { "@type": "Question", name: "Are female teachers available?", acceptedAnswer: { "@type": "Answer", text: "Yes, we have certified female teachers available for sisters and children." } },
      { "@type": "Question", name: "What qualifications do teachers have?", acceptedAnswer: { "@type": "Answer", text: "All teachers hold Ijazah from certified scholars and are graduates of prestigious Islamic universities." } },
      { "@type": "Question", name: "How do sessions work?", acceptedAnswer: { "@type": "Answer", text: "Sessions are conducted via built-in video. After booking confirmation, you receive a session link directly." } },
      { "@type": "Question", name: "Can I reschedule?", acceptedAnswer: { "@type": "Answer", text: "Yes, you can reschedule up to 24 hours before the session at no additional cost." } },
    ],
  };

  // Safe: schema is hardcoded static content, not user-generated
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}
