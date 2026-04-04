import type { Metadata } from "next";
import HomeContent from "./home-content";

export const metadata: Metadata = { title: "فرقان — أكاديمية القرآن الكريم" };

export default function HomePage() {
  return <HomeContent />;
}
