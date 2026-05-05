import type { Metadata } from "next";
import { Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { ModerationClient } from "./moderation-client";

export const metadata: Metadata = {
  title: "المراجعة · Moderation",
};

interface FlaggedMessageRow {
  id: string;
  content: string;
  msg_type: string;
  created_at: string;
  flagged_at: string | null;
  flagged_by: string | null;
  flag_reason: string | null;
  sender_id: string;
  conversation_id: string;
}

interface EvaluationRow {
  id: string;
  student_id: string;
  teacher_id: string;
  evaluation_type: string;
  evaluation_date: string;
  overall_score: number | null;
  areas_for_improvement: string | null;
  created_at: string;
}

interface ConversationRow {
  id: string;
  student_id: string;
  teacher_id: string;
}

interface ProfileNameRow {
  id: string;
  full_name: string;
}

export default async function ModerationPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [messagesRes, evaluationsRes] = await Promise.all([
    supabase
      .from("messages")
      .select("id, content, msg_type, created_at, flagged_at, flagged_by, flag_reason, sender_id, conversation_id")
      .not("flagged_at", "is", null)
      .is("hidden_at", null)
      .order("flagged_at", { ascending: false })
      .limit(100)
      .returns<FlaggedMessageRow[]>(),
    supabase
      .from("session_evaluations")
      .select("id, student_id, teacher_id, evaluation_type, evaluation_date, overall_score, areas_for_improvement, created_at")
      .not("overall_score", "is", null)
      .lte("overall_score", 2.5)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<EvaluationRow[]>(),
  ]);

  const messages = messagesRes.data ?? [];
  const evaluations = evaluationsRes.data ?? [];

  // Resolve conversation pairs for flagged messages (so we can show both parties)
  const conversationIds = Array.from(new Set(messages.map((m) => m.conversation_id)));
  const { data: conversations } =
    conversationIds.length > 0
      ? await supabase
          .from("conversations")
          .select("id, student_id, teacher_id")
          .in("id", conversationIds)
          .returns<ConversationRow[]>()
      : { data: [] as ConversationRow[] };
  const convMap = new Map<string, ConversationRow>();
  for (const c of conversations ?? []) convMap.set(c.id, c);

  // Gather all profile ids we need names for
  const allIds = new Set<string>();
  for (const m of messages) {
    allIds.add(m.sender_id);
    const conv = convMap.get(m.conversation_id);
    if (conv) {
      allIds.add(conv.student_id);
      allIds.add(conv.teacher_id);
    }
  }
  for (const e of evaluations) {
    allIds.add(e.student_id);
    allIds.add(e.teacher_id);
  }

  const { data: profiles } =
    allIds.size > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", Array.from(allIds))
          .returns<ProfileNameRow[]>()
      : { data: [] as ProfileNameRow[] };
  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) nameMap[p.id] = p.full_name;

  // Enrich rows for the client with name/role metadata
  const messagesForClient = messages.map((m) => {
    const conv = convMap.get(m.conversation_id);
    return {
      id: m.id,
      content: m.content,
      msgType: m.msg_type,
      createdAt: m.created_at,
      flaggedAt: m.flagged_at,
      flagReason: m.flag_reason,
      senderId: m.sender_id,
      senderName: nameMap[m.sender_id] ?? "—",
      studentName: conv ? (nameMap[conv.student_id] ?? "—") : "—",
      teacherName: conv ? (nameMap[conv.teacher_id] ?? "—") : "—",
    };
  });

  const evaluationsForClient = evaluations.map((e) => ({
    id: e.id,
    studentId: e.student_id,
    studentName: nameMap[e.student_id] ?? "—",
    teacherName: nameMap[e.teacher_id] ?? "—",
    evaluationType: e.evaluation_type,
    evaluationDate: e.evaluation_date,
    overallScore: e.overall_score,
    areasForImprovement: e.areas_for_improvement,
    createdAt: e.created_at,
  }));

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <Shield size={24} className="text-gold" />
          <h1 className="text-xl font-bold">{t("قائمة المراجعة", "Moderation Queue")}</h1>
        </div>
        <p className="mt-2 text-sm text-muted">
          {t(
            "رسائل مُبلّغ عنها وتقييمات منخفضة بحاجة مراجعة.",
            "Reported messages and low-score evaluations needing review.",
          )}
        </p>
      </header>

      <ModerationClient messages={messagesForClient} evaluations={evaluationsForClient} />
    </div>
  );
}
