import type { Metadata } from "next";
import { AboutContent } from "./content";

export const metadata: Metadata = { title: "من نحن | About" };

export default function AboutPage() {
  return <AboutContent />;
}
