import type { Metadata } from "next";
import { TeachersContent } from "./content";

export const metadata: Metadata = { title: "معلمونا | Teachers" };

export default function TeachersPage() {
  return <TeachersContent />;
}
