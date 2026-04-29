import type { Metadata } from "next";
import { ResourceForm } from "../resource-form";

export const metadata: Metadata = { title: "مصدر جديد" };

export default function NewResourcePage() {
  return <ResourceForm />;
}
