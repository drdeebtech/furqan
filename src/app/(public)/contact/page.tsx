import type { Metadata } from "next";
import { ContactContent } from "./contact-content";

export const metadata: Metadata = { title: "اتصل بنا | Contact" };

export default function ContactPage() {
  return <ContactContent />;
}
