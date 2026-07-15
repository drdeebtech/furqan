"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

const ApproveSchema = z.object({
  id: z.string().uuid(),
});

const RejectSchema = z.object({
  id: z.string().uuid(),
  rejection_reason: z.string().min(1).max(500),
});

export async function approveReview(formData: FormData) {
  await requireAdmin();
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) throw new Error("Unauthenticated");

  const { id } = ApproveSchema.parse({ id: formData.get("id") });

  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_output_review")
    .update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending_review");

  if (error) throw new Error(error.message);

  // Downstream delivery + auto-send gate. The approval itself already succeeded,
  // so failures here must log, not throw. Uses the service-role admin client so RLS
  // can't silently drop the bookings lookup / parent_reports + notifications inserts /
  // gate update. The status UPDATE above stays on the session client for the audit trail.
  // admin: requireAdmin; cross-user fan-out (parent_reports + notifications + bulk update) (issue #523)
  const db = createAdminClient();
  try {
    const { data: row } = await db
      .from("ai_output_review")
      .select("workflow_name, entity_id, entity_type, output_text, output_json")
      .eq("id", id)
      .single();

    if (row) {
      // Workflow-specific delivery.
      if (row.workflow_name === "monthly-progress-ai") {
        // parent_reports requires teacher_id (NOT NULL). Resolve from the student's
        // most recent completed booking. report_type enum has no 'monthly_ai' value,
        // so 'custom' is the closest accepted value. Content column is `content`.
        const { data: booking } = await db
          .from("bookings")
          .select("teacher_id")
          .eq("student_id", row.entity_id)
          .eq("status", "completed")
          .order("scheduled_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        if (booking?.teacher_id) {
          const { error: prError } = await db.from("parent_reports").insert({
            student_id: row.entity_id,
            teacher_id: booking.teacher_id,
            report_type: "custom",
            content: row.output_text,
            sent_at: new Date().toISOString(),
          });
          if (prError) {
            logError("approveReview: parent_reports insert failed", prError, {
              tag: "admin-ai-review",
              workflow: row.workflow_name,
              student_id: row.entity_id,
            });
          }
        } else {
          logError("approveReview: no completed teacher found for student", new Error("teacher-not-found"), {
            tag: "admin-ai-review",
            workflow: row.workflow_name,
            student_id: row.entity_id,
          });
        }
      } else if (row.workflow_name === "curriculum-advisor") {
        // notifications.type is the notif_type enum (no 'curriculum_advice' value),
        // so 'system' is the closest accepted value. title is NOT NULL.
        const { error: nError } = await db.from("notifications").insert({
          user_id: row.entity_id,
          type: "system",
          title: "New curriculum advice ready for review",
          body: row.output_text,
          is_read: false,
        });
        if (nError) {
          logError("approveReview: notifications insert failed", nError, {
            tag: "admin-ai-review",
            workflow: row.workflow_name,
            user_id: row.entity_id,
          });
        }
      }

      // auto_send_eligible gate: ≥30 approvals AND ≥90% approval rate for this workflow.
      // Single atomic RPC (counts taken from one snapshot — no drift between queries).
      const { data: gate } = await db.rpc("ai_review_gate", {
        p_workflow_name: row.workflow_name,
      });
      const approved = (gate?.[0]?.approved_count ?? 0) as number;
      const total = (gate?.[0]?.total_reviewed ?? 0) as number;
      const approvalRate = total > 0 ? approved / total : 0;
      if (approved >= 30 && approvalRate >= 0.9) {
        const { error: gateError } = await db
          .from("ai_output_review")
          .update({ auto_send_eligible: true })
          .eq("workflow_name", row.workflow_name)
          .eq("status", "pending_review");
        if (gateError) {
          logError("approveReview: auto_send_eligible gate failed", gateError, {
            tag: "admin-ai-review",
            workflow: row.workflow_name,
          });
        }
      }
    }
  } catch (e) {
    logError("approveReview: downstream delivery failed", e, {
      tag: "admin-ai-review",
      review_id: id,
    });
  }

  revalidatePath("/admin/ai-review");
}

export async function rejectReview(formData: FormData) {
  await requireAdmin();
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) throw new Error("Unauthenticated");

  const { id, rejection_reason } = RejectSchema.parse({
    id: formData.get("id"),
    rejection_reason: formData.get("rejection_reason"),
  });

  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_output_review")
    .update({
      status: "rejected",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason,
    })
    .eq("id", id)
    .eq("status", "pending_review");

  if (error) throw new Error(error.message);
  revalidatePath("/admin/ai-review");
}
