import type { Metadata } from "next";
import { ServicesContent } from "./content";

export const metadata: Metadata = { title: "خدماتنا | Services" };

export default function ServicesPage() {
  return <ServicesContent />;
}
