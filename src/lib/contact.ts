export const CONTACT = {
  whatsapp: "+965 9779 5626",
  whatsappUrl: "https://wa.me/96597795626",
  whatsappUrlWithMessage:
    "https://wa.me/96597795626?text=%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%AC%D9%84%D8%B3%D8%A9%20%D8%AA%D8%AC%D8%B1%D9%8A%D8%A8%D9%8A%D8%A9%20%D9%85%D8%AC%D8%A7%D9%86%D9%8A%D8%A9",
  // support@ is the public support address (Wave 0 — decision 48). The mailbox
  // MUST be routed and a real send/receive verified BEFORE this merges.
  email: "support@furqan.today",
  emailUrl: "mailto:support@furqan.today",
  partnerships: "partnerships@furqan.today",
  partnershipsUrl: "mailto:partnerships@furqan.today",
  // Honest framing (decision 44): 4 teachers cannot honestly cover "24 hours,
  // 7 days" — claim flexible scheduling instead.
  availability: {
    ar: "مواعيد مرنة عبر المناطق الزمنية",
    en: "Flexible scheduling across time zones",
  },
  flag: "🇰🇼",
  country: {
    ar: "الكويت",
    en: "Kuwait",
  },
} as const;

// TODO: Add real social media accounts when ready
// export const SOCIAL = {
//   facebook: "https://facebook.com/furqanacademy",
//   instagram: "https://instagram.com/furqanacademy",
//   youtube: "https://youtube.com/@furqanacademy",
// };
