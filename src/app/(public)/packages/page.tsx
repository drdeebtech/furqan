import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { Testimonials } from "@/components/public/testimonials";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";
import { CurrencyPackages } from "./currency-packages";

export const metadata: Metadata = { title: "باقاتنا" };

export default function PackagesPage() {
  return (
    <div dir="rtl">
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted">
          <Link href="/" className="text-gold hover:text-gold-light">الرئيسية</Link> / باقاتنا
        </p>
        <h1 className="font-display mt-4 text-5xl font-bold">باقاتنا</h1>
        <p className="mt-2 text-muted">Our Packages</p>
      </section>

      <CurrencyPackages />

      {/* Discounts */}
      <section className="border-t border-card-border py-24">
        <div className="mx-auto max-w-4xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ خصومات</p>
          <h2 className="font-display mt-3 text-3xl font-bold">سياسة الخصومات</h2>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              { period: "دفع سنوي", save: "وفّر ٢٠٪" },
              { period: "دفع نصف سنوي", save: "وفّر ١٠٪" },
              { period: "دفع ربع سنوي", save: "وفّر ٥٪" },
            ].map((d) => (
              <div key={d.period} className="rounded-xl border border-card-border bg-card p-6 text-center">
                <p className="font-bold">{d.period}</p>
                <p className="font-display mt-2 text-2xl font-bold text-gold">{d.save}</p>
              </div>
            ))}
          </div>

          {/* Referral */}
          <div className="mt-12 rounded-xl border border-gold/20 bg-gold/5 p-8">
            <h3 className="text-lg font-bold">برنامج الإحالة</h3>
            <p className="mt-2 text-sm text-muted">أحِل أصدقاءك واحصل على خصم:</p>
            <div className="mt-4 flex flex-wrap gap-6 text-sm">
              <span>إحالة طالب واحد → <strong className="text-gold">خصم ١٥٪</strong></span>
              <span>إحالة طالبين → <strong className="text-gold">خصم ٢٥٪</strong></span>
            </div>
            <Link href="/contact" className="mt-4 inline-block text-sm text-gold hover:text-gold-light">اتصل بنا لمعرفة التفاصيل ←</Link>
          </div>
        </div>
      </section>

      <div className="border-t border-card-border"><Testimonials /></div>
      <FreeTrialBanner />
    </div>
  );
}
