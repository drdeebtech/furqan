import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ServicesContent } from "./content";
import { BreadcrumbSchema } from "@/components/seo/structured-data";

export const metadata: Metadata = {
  title: "خدماتنا — حفظ وتجويد وتلاوة",
  description: "خدمات أكاديمية فرقان: حفظ القرآن، أحكام التجويد، المراجعة، التلاوة، القراءات، التفسير.",
  alternates: { canonical: "https://www.furqan.today/services" },
};

export default async function ServicesPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("services")
    .select("id, title, title_ar, description, description_ar, features, features_ar, icon, image_url")
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .returns<{
      id: string; title: string; title_ar: string | null;
      description: string; description_ar: string | null;
      features: string[]; features_ar: string[];
      icon: string | null; image_url: string | null;
    }[]>();

  return (
    <>
      <BreadcrumbSchema items={[
        { name: "الرئيسية", url: "https://www.furqan.today" },
        { name: "خدماتنا", url: "https://www.furqan.today/services" },
      ]} />
      <ServicesContent services={data ?? []} />
    </>
  );
}
