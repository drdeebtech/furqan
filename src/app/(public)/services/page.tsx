import type { Metadata } from "next";
import { ServicesContent } from "./content";

export const metadata: Metadata = {
  title: "خدماتنا — حفظ وتجويد وتلاوة",
  description: "خدمات أكاديمية فرقان: حفظ القرآن، أحكام التجويد، المراجعة، التلاوة، القراءات، التفسير.",
  alternates: { canonical: "https://furqan.today/services" },
};

export default function ServicesPage() {
  return <ServicesContent />;
}
