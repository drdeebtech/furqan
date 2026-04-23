import type { Metadata } from "next";
import TeachContent from "./teach-content";

export const metadata: Metadata = {
  title: "درّس معنا — فرقان أكاديمي",
  description:
    "انضم إلى هيئة التدريس في أكاديمية فرقان. نبحث عن معلمين حاصلين على الإجازة في القرآن الكريم لتعليم الطلاب حول العالم.",
  alternates: { canonical: "https://furqan.today/teach" },
};

export default function TeachPage() {
  return <TeachContent />;
}
