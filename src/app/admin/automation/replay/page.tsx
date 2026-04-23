import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ReplayClient } from "./replay-client";

export const metadata: Metadata = {
  title: "إعادة تشغيل · Webhook Replay",
};

interface FailedLogRow {
  id: string;
  workflow_name: string;
  event_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  idempotency_key: string | null;
  payload_json: Record<string, unknown> | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface DeadLetterRow {
  id: string;
  workflow_name: string;
  event_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  idempotency_key: string | null;
  payload_json: Record<string, unknown> | null;
  last_error: string | null;
  attempt_count: number;
  first_failed_at: string;
  last_failed_at: string;
}

export default async function AdminReplayPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || profile.role !== "admin") redirect("/login");

  const [failedRes, deadLetterRes] = await Promise.all([
    supabase
      .from("automation_logs")
      .select("id, workflow_name, event_name, entity_type, entity_id, idempotency_key, payload_json, status, error_message, started_at, finished_at")
      .eq("status", "failed")
      .order("started_at", { ascending: false })
      .limit(50)
      .returns<FailedLogRow[]>(),
    supabase
      .from("automation_dead_letter")
      .select("id, workflow_name, event_name, entity_type, entity_id, idempotency_key, payload_json, last_error, attempt_count, first_failed_at, last_failed_at")
      .is("resolved_at", null)
      .order("last_failed_at", { ascending: false })
      .limit(50)
      .returns<DeadLetterRow[]>(),
  ]);

  const failures = failedRes.data ?? [];
  const deadLetters = deadLetterRes.data ?? [];

  return (
    <div dir="rtl" className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <RotateCcw size={24} className="text-gold" />
          <h1 className="text-xl font-bold">إعادة تشغيل الأتمتة</h1>
          <span className="text-sm text-muted">Webhook Replay</span>
        </div>
        <p className="mt-2 text-sm text-muted">
          إعادة إرسال الأحداث الفاشلة إلى n8n. كل محاولة تُسجَّل كسجل جديد.
        </p>
      </header>

      <ReplayClient failures={failures} deadLetters={deadLetters} />
    </div>
  );
}
