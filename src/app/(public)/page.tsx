import type { Metadata } from "next";
import HomeContent from "./home-content";

export const metadata: Metadata = {
  title: "فرقان — تعلم القرآن الكريم مع معلمين معتمدين",
  description: "أكاديمية فرقان لتعليم القرآن عبر الإنترنت. حفظ وتجويد وتلاوة مع معلمين حاصلين على الإجازة. سجّل الآن وابدأ.",
  alternates: { canonical: "https://furqan.today" },
};

export default function HomePage() {
  return <HomeContent />;
}
