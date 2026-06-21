import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuthedCronMonitor } from "@/lib/sentry/cron";
import { logError } from "@/lib/logger";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";
import {
  bunnyStatusToVideoStatus,
  getVideo,
  isBunnyConfigured,
} from "@/lib/bunny/client";

export const dynamic = "force-dynamic";

/**
 * Webhook-less recovery for lessons stuck in `uploading` or `processing`.
 *
 * The Bunny webhook is the primary signal that a video has finished
 * encoding. When it doesn't land — secret missing, signature mismatch,
 * Vercel function cold-start timeout, network blip — `LessonUploader`
 * polls `syncLessonStatusFromBunny` for 6 minutes after the upload
 * completes. If the teacher closes the tab before transcoding finishes,
 * that polling stops and the lesson stays at `processing` forever.
 *
 * Triggered by an n8n workflow on the Mac mini (Vercel Hobby allows
 * only daily crons, so frequent recovery polling lives where furqan's
 * other automation already runs). The workflow should call this
 * endpoint with the `X-N8N-Secret` header set to N8N_WEBHOOK_SECRET.
 * Cadence is up to operator preference — every 15-30 min is plenty.
 *
 * Finds any lesson whose `video_status` is still `uploading` or
 * `processing` after 30 minutes since last update, re-asks Bunny what
 * the actual status is. Mirrors `syncLessonStatusFromBunny` but
 * bypasses per-row teacher auth (cron runs as service role) and
 * processes a batch.
 *
 * Safe to re-run; idempotent — calling Bunny on an already-ready video
 * just returns its terminal status. The schedule string passed to
 * withCronMonitor is informational (Sentry monitor cadence label); it
 * does not affect when the endpoint actually runs.
 */
export const GET = withAuthedCronMonitor(
  "cron-bunny-stuck-lessons",
  "*/30 * * * *",
  async () => {
    if (!isBunnyConfigured()) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "Bunny.net not configured",
      });
    }

    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const admin = createAdminClient();

    const { data: stuck, error: queryErr } = await admin
      .from("course_lessons")
      .select("id, course_id, bunny_video_id, video_status, updated_at")
      .in("video_status", ["uploading", "processing"])
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(50)
      .returns<
        {
          id: string;
          course_id: string;
          bunny_video_id: string | null;
          video_status: string;
          updated_at: string;
        }[]
      >();

    if (queryErr) {
      throw new Error(`bunny-stuck-lessons query: ${queryErr.message}`);
    }

    if (!stuck || stuck.length === 0) {
      return NextResponse.json({
        ok: true,
        scanned: 0,
        updated: 0,
        at: new Date().toISOString(),
      });
    }

    let updatedCount = 0;
    let failedCount = 0;
    const affectedCourseIds = new Set<string>();
    const flippedToReady: string[] = [];

    for (const lesson of stuck) {
      if (!lesson.bunny_video_id) continue;
      try {
        const info = await getVideo(lesson.bunny_video_id);
        const newStatus = bunnyStatusToVideoStatus(info.status);

        // null = non-status event (CaptionsGenerated etc.) — keep current.
        if (newStatus === null) continue;
        if (newStatus === lesson.video_status) continue;

        const updates: TableUpdate<"course_lessons"> = { video_status: newStatus };
        if (info.length && info.length > 0) {
          updates.duration_seconds = Math.round(info.length);
        }

        const { error: updateErr } = await admin
          .from("course_lessons")
          .update(updates)
          .eq("id", lesson.id);

        if (updateErr) {
          logError("bunny-stuck-lessons: lesson update failed", updateErr, {
            tag: "bunny-cron",
            lessonId: lesson.id,
          });
          failedCount++;
          continue;
        }

        updatedCount++;
        affectedCourseIds.add(lesson.course_id);
        if (newStatus === "ready") flippedToReady.push(lesson.id);
      } catch (err) {
        logError("bunny-stuck-lessons: getVideo failed", err, {
          tag: "bunny-cron",
          lessonId: lesson.id,
          bunnyVideoId: lesson.bunny_video_id,
        });
        failedCount++;
      }
    }

    // Recompute course duration aggregates for any course whose lesson set changed.
    for (const courseId of affectedCourseIds) {
      try {
        const { data: readyLessons } = await admin
          .from("course_lessons")
          .select("duration_seconds")
          .eq("course_id", courseId)
          .eq("video_status", "ready")
          .returns<{ duration_seconds: number | null }[]>();

        if (readyLessons) {
          const total = readyLessons.reduce(
            (sum, l) => sum + (l.duration_seconds ?? 0),
            0,
          );
          await admin
            .from("courses")
            .update({ duration_seconds_cached: total } satisfies TableUpdate<"courses">)
            .eq("id", courseId);
        }
      } catch (err) {
        logError("bunny-stuck-lessons: duration recompute failed", err, {
          tag: "bunny-cron",
          courseId,
        });
      }
    }

    // Best-effort log entry to automation_logs for "did the cron find anything?".
    await admin
      .from("automation_logs")
      .insert({
        workflow_name: "bunny.stuck-lessons-cron",
        event_name: "bunny.cron.scan",
        status: failedCount > 0 ? "failed" : "succeeded",
        payload_json: { scanned: stuck.length, cutoff } as never,
        result_json: {
          updated: updatedCount,
          failed: failedCount,
          flippedToReady,
        } as never,
        finished_at: new Date().toISOString(),
      } as never)
      .then(({ error }) => {
        if (error) {
          logError("bunny-stuck-lessons: automation_logs insert failed", error, {
            tag: "bunny-cron",
          });
        }
      });

    return NextResponse.json({
      ok: true,
      scanned: stuck.length,
      updated: updatedCount,
      failed: failedCount,
      flippedToReady,
      at: new Date().toISOString(),
    });
  },
);
