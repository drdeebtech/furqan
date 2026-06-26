"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { loudAction } from "@/lib/actions/loud";
import { UserError } from "@/lib/actions/user-error";

// ─── createThread ───────────────────────────────────────────────────────────
// Returns { ok, id? } — id must be preserved for callers; keep manual pattern.

export async function createThread(formData: FormData): Promise<{ ok: boolean; error?: string; id?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const title_ar = String(formData.get("title_ar") ?? "").trim();
  const body_ar = String(formData.get("body_ar") ?? "").trim();
  if (!title_ar) return { ok: false, error: "العنوان مطلوب" };
  if (!body_ar) return { ok: false, error: "المحتوى مطلوب" };

  const insert: TableInsert<"forum_threads"> = {
    author_id: user.id,
    title_ar,
    title_en: String(formData.get("title_en") ?? "").trim() || null,
    body_ar,
    body_en: String(formData.get("body_en") ?? "").trim() || null,
    category: String(formData.get("category") ?? "general").trim() || "general",
  };

  const { data, error } = await supabase.from("forum_threads")
    .insert(insert).select("id").single<{ id: string }>();
  if (error || !data) {
    logError("community.createThread failed", error, { tag: "community" });
    return { ok: false, error: error?.message ?? "لم يتم العثور على السجل" };
  }
  revalidatePath("/community");
  return { ok: true, id: data.id };
}

// ─── createReply ────────────────────────────────────────────────────────────
// Returns { ok, id? } — id must be preserved for callers; keep manual pattern.

export async function createReply(threadId: string, formData: FormData): Promise<{ ok: boolean; error?: string; id?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const body_ar = String(formData.get("body_ar") ?? "").trim();
  if (!body_ar) return { ok: false, error: "المحتوى مطلوب" };

  // Reject if thread is locked.
  const { data: thread } = await supabase.from("forum_threads")
    .select("author_id, is_locked, is_hidden, title_ar")
    .eq("id", threadId)
    .single<{ author_id: string; is_locked: boolean; is_hidden: boolean; title_ar: string }>();
  if (!thread) return { ok: false, error: "الموضوع غير موجود" };
  if (thread.is_hidden) return { ok: false, error: "الموضوع مخفي" };
  if (thread.is_locked) return { ok: false, error: "الموضوع مغلق" };

  const insert: TableInsert<"forum_replies"> = {
    thread_id: threadId,
    author_id: user.id,
    body_ar,
    body_en: String(formData.get("body_en") ?? "").trim() || null,
  };

  const { data, error } = await supabase.from("forum_replies")
    .insert(insert).select("id").single<{ id: string }>();
  if (error || !data) {
    logError("community.createReply failed", error, { tag: "community" });
    return { ok: false, error: error?.message ?? "لم يتم العثور على السجل" };
  }

  // Notify the thread author (skip if they're replying to themselves).
  if (thread.author_id !== user.id) {
    try {
      await notify({
        userId: thread.author_id,
        type: "system",
        title: `رد جديد على موضوعك`,
        body: thread.title_ar,
        entityType: "forum_thread",
        entityId: threadId,
        templateName: "forum.reply_received",
      });
    } catch (e) {
      logError("community.createReply notify failed", e, { tag: "community" });
    }
  }

  revalidatePath(`/community/${threadId}`);
  revalidatePath("/community");
  return { ok: true, id: data.id };
}

// ─── toggleLike ─────────────────────────────────────────────────────────────

const toggleLikeBase = loudAction<
  { targetType: "thread" | "reply"; targetId: string },
  void
>({
  name: "community.toggleLike",
  handler: async ({ targetType, targetId }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مسجل الدخول");

    const { data: existing } = await supabase.from("forum_likes")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .maybeSingle();

    if (existing) {
      // Delete is already idempotent — removing a row that a racing click
      // already removed is a no-op, not an error.
      const { error } = await supabase.from("forum_likes").delete()
        .eq("user_id", user.id)
        .eq("target_type", targetType)
        .eq("target_id", targetId);
      if (error) throw new UserError("فشل إزالة الإعجاب", { cause: error });
    } else {
      // Idempotent like: the read above is a stale snapshot, so two racing
      // double-clicks can both reach this branch. ON CONFLICT DO NOTHING (the
      // composite PK user_id+target_type+target_id dedupes) means the loser of
      // the race silently succeeds instead of surfacing a 23505 duplicate-key
      // error to the user (correctness tail, #345).
      const { error } = await supabase.from("forum_likes").upsert({
        user_id: user.id, target_type: targetType, target_id: targetId,
      } satisfies TableInsert<"forum_likes">, {
        onConflict: "user_id,target_type,target_id",
        ignoreDuplicates: true,
      });
      if (error) throw new UserError("فشل إضافة الإعجاب", { cause: error });
    }
    revalidatePath("/community");
  },
});

export async function toggleLike(
  targetType: "thread" | "reply",
  targetId: string,
) {
  return toggleLikeBase({ targetType, targetId });
}

// ─── reportContent ──────────────────────────────────────────────────────────

const reportContentBase = loudAction<
  { targetType: "thread" | "reply"; targetId: string; reason: string },
  void
>({
  name: "community.reportContent",
  handler: async ({ targetType, targetId, reason }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مسجل الدخول");

    const trimmed = reason.trim();
    if (trimmed.length < 3) throw new UserError("أدخل سببًا واضحًا");

    const { error } = await supabase.from("forum_reports").insert({
      reporter_id: user.id,
      target_type: targetType,
      target_id: targetId,
      reason: trimmed,
    } satisfies TableInsert<"forum_reports">);
    if (error) throw new UserError("فشل إرسال البلاغ", { cause: error });

    revalidatePath("/admin/community");
  },
});

export async function reportContent(
  targetType: "thread" | "reply",
  targetId: string,
  reason: string,
) {
  return reportContentBase({ targetType, targetId, reason });
}

// ─── moderateThread ─────────────────────────────────────────────────────────
// Pin / lock / hide / unhide a thread. Admin-gated.

const moderateThreadBase = loudAction<
  { threadId: string; patch: { is_pinned?: boolean; is_locked?: boolean; is_hidden?: boolean } },
  void
>({
  name: "community.moderateThread",
  severity: "warning",
  handler: async ({ threadId, patch }) => {
    try {
      await requireAdmin();
    } catch (e) {
      if (e instanceof ForbiddenError) throw new UserError("ليس لديك صلاحية");
      throw e;
    }

    // Use admin client so RLS doesn't gate when mod isn't the author.
    // admin: requireAdmin; moderation updates another user's thread/reply/report (issue #523)
    const admin = createAdminClient();
    const update: TableUpdate<"forum_threads"> = {};
    if (typeof patch.is_pinned === "boolean") update.is_pinned = patch.is_pinned;
    if (typeof patch.is_locked === "boolean") update.is_locked = patch.is_locked;
    if (typeof patch.is_hidden === "boolean") update.is_hidden = patch.is_hidden;

    const { error } = await admin.from("forum_threads").update(update).eq("id", threadId);
    if (error) throw new UserError("فشل تحديث الموضوع", { cause: error });

    revalidatePath("/admin/community");
    revalidatePath("/community");
    revalidatePath(`/community/${threadId}`);
  },
});

export async function moderateThread(
  threadId: string,
  patch: { is_pinned?: boolean; is_locked?: boolean; is_hidden?: boolean },
) {
  return moderateThreadBase({ threadId, patch });
}

// ─── moderateReply ──────────────────────────────────────────────────────────

const moderateReplyBase = loudAction<
  { replyId: string; is_hidden: boolean },
  void
>({
  name: "community.moderateReply",
  severity: "warning",
  handler: async ({ replyId, is_hidden }) => {
    try {
      await requireAdmin();
    } catch (e) {
      if (e instanceof ForbiddenError) throw new UserError("ليس لديك صلاحية");
      throw e;
    }
    // admin: requireAdmin; moderation updates another user's thread/reply/report (issue #523)
    const admin = createAdminClient();
    const { error } = await admin.from("forum_replies")
      .update({ is_hidden } satisfies TableUpdate<"forum_replies">)
      .eq("id", replyId);
    if (error) throw new UserError("فشل تحديث الرد", { cause: error });

    revalidatePath("/admin/community");
    revalidatePath("/community");
  },
});

export async function moderateReply(replyId: string, is_hidden: boolean) {
  return moderateReplyBase({ replyId, is_hidden });
}

// ─── resolveReport ──────────────────────────────────────────────────────────

const resolveReportBase = loudAction<
  { reportId: string; status: "resolved" | "dismissed" },
  void
>({
  name: "community.resolveReport",
  severity: "warning",
  handler: async ({ reportId, status }) => {
    let actor: { id: string };
    try {
      actor = await requireAdmin();
    } catch (e) {
      if (e instanceof ForbiddenError) throw new UserError("ليس لديك صلاحية");
      throw e;
    }
    // admin: requireAdmin; moderation updates another user's thread/reply/report (issue #523)
    const admin = createAdminClient();
    const { error } = await admin.from("forum_reports").update({
      status,
      resolved_by: actor.id,
      resolved_at: new Date().toISOString(),
    } satisfies TableUpdate<"forum_reports">).eq("id", reportId);
    if (error) throw new UserError("فشل تحديث البلاغ", { cause: error });

    revalidatePath("/admin/community");
  },
});

export async function resolveReport(
  reportId: string,
  status: "resolved" | "dismissed",
) {
  return resolveReportBase({ reportId, status });
}
