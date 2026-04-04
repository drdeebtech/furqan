import Link from "next/link";

/**
 * Render the public site footer containing brand, navigation, services, and contact sections.
 *
 * Renders a styled <footer> with a four-column top section (brand, quick links, services, contact)
 * and a bottom bar with copyright text.
 *
 * @returns The footer as a JSX element containing brand info, internal links, external contact links, and copyright.
 */
export function PublicFooter() {
  return (
    <footer className="border-t border-card-border bg-card">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 md:grid-cols-4">
        {/* Brand */}
        <div>
          <span className="font-display text-2xl font-bold text-gold">فُرقان</span>
          <p className="mt-3 text-sm text-foreground">أكاديمية القرآن الكريم عبر الإنترنت</p>
          <p className="mt-1 text-xs text-muted">نربط الطلاب بأفضل معلمي القرآن المعتمدين حول العالم</p>
          <div className="mt-4 flex gap-3 text-xs text-muted">
            <span className="cursor-pointer transition-colors hover:text-gold">Facebook</span>
            <span className="cursor-pointer transition-colors hover:text-gold">Instagram</span>
            <span className="cursor-pointer transition-colors hover:text-gold">YouTube</span>
          </div>
        </div>

        {/* Quick Links */}
        <div>
          <h4 className="mb-3 text-sm font-bold text-gold">روابط سريعة</h4>
          <ul className="space-y-2 text-sm text-muted">
            {[
              { href: "/", label: "الرئيسية" },
              { href: "/about", label: "من نحن" },
              { href: "/services", label: "خدماتنا" },
              { href: "/packages", label: "باقاتنا" },
              { href: "/blog", label: "المدونة" },
              { href: "/contact", label: "اتصل بنا" },
              { href: "/login", label: "🔒 بوابة الطلاب" },
            ].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="transition-colors hover:text-gold">{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Services */}
        <div>
          <h4 className="mb-3 text-sm font-bold text-gold">خدماتنا</h4>
          <ul className="space-y-2 text-sm text-muted">
            {["حفظ القرآن", "تجويد القرآن", "مراجعة الحفظ", "التلاوة", "القراءات", "تفسير القرآن"].map((s) => (
              <li key={s}>
                <Link href="/services" className="transition-colors hover:text-gold">{s}</Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Contact */}
        <div>
          <h4 className="mb-3 text-sm font-bold text-gold">تواصل معنا</h4>
          <ul className="space-y-2 text-sm text-muted">
            <li>
              <a href="https://wa.me/447400000000" className="transition-colors hover:text-gold">
                🇬🇧 WhatsApp UK: +44 74 0000 0000
              </a>
            </li>
            <li>
              <a href="https://wa.me/12125550000" className="transition-colors hover:text-gold">
                🇺🇸 WhatsApp US: +1 212 555 0000
              </a>
            </li>
            <li>info@furqan.academy</li>
            <li className="text-xs">متاح ٧ أيام في الأسبوع · ٢٤ ساعة</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-card-border px-6 py-6">
        <p className="text-center text-xs text-muted">
          © 2025 فرقان · جميع الحقوق محفوظة
        </p>
      </div>
    </footer>
  );
}
