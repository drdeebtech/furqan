import type { Metadata } from "next";
import { TeachersContent } from "./content";

export const metadata: Metadata = {
  title: "معلمونا — معلمو القرآن المعتمدون",
  description: "معلمو أكاديمية فرقان حاصلون على الإجازة من كبار العلماء. خريجو الأزهر. متاح معلمات للأخوات.",
  alternates: { canonical: "https://furqan.today/teachers-page" },
};

export default function TeachersPage() {
  return <TeachersContent />;
}
