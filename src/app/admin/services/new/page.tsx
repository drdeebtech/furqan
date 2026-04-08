import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ServiceForm } from "../service-form";

export const metadata: Metadata = { title: "إضافة خدمة" };

export default function NewServicePage() {
  return (
    <div dir="rtl" className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/admin/services" className="mb-6 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover">
        <ArrowRight size={14} /> العودة للخدمات
      </Link>
      <h1 className="mb-6 text-2xl font-bold">إضافة خدمة جديدة</h1>
      <div className="glass-card rounded-xl p-6">
        <ServiceForm />
      </div>
    </div>
  );
}
