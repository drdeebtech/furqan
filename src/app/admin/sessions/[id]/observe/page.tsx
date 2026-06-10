import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { ObserverRoom } from "./observer-room";

export const metadata: Metadata = { title: "مراقبة الجلسة" };

export default async function ObserveSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, dir } = await getT();
  const supabase = await createClient();

  // Fetch session
  const { data: session } = await supabase
    .from("sessions")
    .select("id, room_url, room_name, expires_at, ended_at, is_observable")
    .eq("id", id).single()
    .then(r => ({ data: r.data as { id: string; room_url: string; room_name: string; expires_at: string | null; ended_at: string | null; is_observable: boolean } | null }));

  if (!session) notFound();

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href={`/admin/sessions/${id}`} className="glass rounded-lg p-2 text-muted transition-colors">
          <ArrowRight size={16} />
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Eye size={24} className="text-gold" />
          {t("مراقبة الجلسة", "Observe Session")}
        </h1>
      </div>
      <ObserverRoom sessionId={session.id} />
    </div>
  );
}
