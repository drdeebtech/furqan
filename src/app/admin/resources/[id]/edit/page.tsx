import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResourceForm } from "../../resource-form";

export const metadata: Metadata = { title: "تعديل مصدر" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditResourcePage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("resources")
    .select("id, title_ar, title_en, description_ar, description_en, resource_type, file_url, external_url, category, tags, is_published")
    .eq("id", id)
    .single<{
      id: string;
      title_ar: string; title_en: string | null;
      description_ar: string | null; description_en: string | null;
      resource_type: string;
      file_url: string | null; external_url: string | null;
      category: string;
      tags: string[];
      is_published: boolean;
    }>();

  if (!data) notFound();
  return <ResourceForm initial={data} />;
}
