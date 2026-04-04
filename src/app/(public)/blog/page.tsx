import type { Metadata } from "next";
import { BlogContent } from "./content";

export const metadata: Metadata = { title: "المدونة | Blog" };

export default function BlogPage() {
  return <BlogContent />;
}
