import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { Package } from "@/types/database";
import { PackagesContent } from "./packages-content";
import { BreadcrumbSchema } from "@/components/seo/structured-data";

export const metadata: Metadata = {
  title: "باقاتنا — أسعار تعلم القرآن",
  description: "باقات أكاديمية فرقان لتعليم القرآن. من 2 جلسات أسبوعياً إلى 5 جلسات. أسعار مناسبة بالدولار والجنيه الإسترليني والريال.",
  alternates: { canonical: "https://furqan.today/packages" },
};

export default async function PackagesPage() {
  const supabase = await createClient();
  const { data: packages } = await supabase
    .from("packages")
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .returns<Package[]>();

  return (
    <>
      <BreadcrumbSchema items={[
        { name: "الرئيسية", url: "https://furqan.today" },
        { name: "باقاتنا", url: "https://furqan.today/packages" },
      ]} />
      <PackagesContent packages={packages ?? []} />
    </>
  );
}
