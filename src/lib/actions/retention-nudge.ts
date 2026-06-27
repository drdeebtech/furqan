import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { isFeatureEnabled } from "@/lib/settings";
import { chunk } from "@/lib/promise-utils";
import { notify } from "@/lib/notifications/dispatcher";
import { isInQuietHours } from "@/lib/notifications/dispatcher-quiet-hours";
import { sendPushToUser } from "@/lib/push/send";
import { emitEvent } from "@/lib/automation/emit";
import { surahName } from "@/lib/quran/surahs";

/**
 * Spec 030 — Student re-engagement nudge (closes #551).
 *
 * Detects active students whose last session was 7+ days ago (capped at 60d so
 * we don't nudge truly-churned users), and sends a personalized, encouraging
 * nudge over web-push + in-app, respecting quiet hours / opt-out and a
 * per-student 14-day cooldown. All detection, copy, and dispatch live here in
 * `src/lib` (CI coverage excludes `src/app/api/**`); the route is a thin
 * auth shell.
 *
 * Idempotency is the per-student `retention_signals.last_intervention_at` stamp
 * (detection filters out anyone stamped within the cooldown window), so a retry
 * after a mid-batch crash resumes without double-nudging. The daily
 * `automation_logs` row is a completion marker written AFTER the batch, not a
 * start-gate — writing it first would let a partial failure suppress same-day
 * retries. (Spec 030 decision #4.)
 */

// Named constants (spec decision #3). 7d lapsed, 14d cooldown, 60d cap.
const LAPSED_DAYS = 7;
const COOLDOWN_DAYS = 14;
const CAP_DAYS = 60;
const CHUNK = 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const REENGAGE_DETECTION = {
  lapsedDays: LAPSED_DAYS,
  cooldownDays: COOLDOWN_DAYS,
  capDays: CAP_DAYS,
} as const;

export interface ReengageResult {
  detected: number;
  nudged: number;
  skipped: number;
}

interface LapsedStudent {
  student_id: string;
  last_session_at: string;
}

interface StudentProgress {
  surah_to: number | null;
  ayah_to: number | null;
}

interface PrefsRow {
  in_app_enabled: boolean | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  important_only_mode: boolean | null;
}

/**
 * Build the personalized nudge copy for one student. Quran integrity (AGENTS.md
 * §2): the surah name comes ONLY from the canonical `src/lib/quran/surahs.ts`
 * — never generated or "corrected". We echo the last recorded ayah (never
 * overstate progress); if there's no progress row, fall back to a generic warm
 * nudge. Copy is Arabic-first RTL.
 */
export function buildNudgeCopy(progress: StudentProgress | null): {
  title: string;
  body: string;
} {
  if (progress && progress.surah_to != null && progress.surah_to >= 1 && progress.surah_to <= 114) {
    const name = surahName(progress.surah_to, "ar");
    if (name) {
      // Only claim a specific ayah when we actually have one — naming "آية 1"
      // for a null ayah_to would OVERSTATE progress (AGENTS.md §2). Otherwise
      // name the surah only.
      const lastPlace =
        progress.ayah_to != null ? `${name} — آية ${progress.ayah_to}` : name;
      return {
        title: "واصل رحلتك مع القرآن 🌙",
        body: `نتظرُك في جلستك القادمة. آخر ما وصلت إليه: ${lastPlace}. حافظك الله.`,
      };
    }
  }
  // Generic warm fallback — no progress row or invalid surah. Never overstate.
  return {
    title: "واصل رحلتك مع القرآن 🌙",
    body: "نتظرُك في جلستك القادمة. كل خطوة في حفظ كتاب الله نورٌ لك. أهلًا بك متى جاهز.",
  };
}

/**
 * Is the student currently in their quiet hours? Mirrors the gate in
 * `dispatcher.ts` so the push channel respects the same window as in-app.
 */
function userInQuietHours(prefs: PrefsRow | null): boolean {
  if (!prefs?.quiet_hours_start || !prefs?.quiet_hours_end) return false;
  const now = new Date();
  const hours = now.getUTCHours().toString().padStart(2, "0");
  const mins = now.getUTCMinutes().toString().padStart(2, "0");
  const currentTime = `${hours}:${mins}`;
  return isInQuietHours(currentTime, prefs.quiet_hours_start, prefs.quiet_hours_end);
}

/**
 * The detection predicate (pure, exported for unit testing). Returns true if a
 * student with this last_session_at / last_intervention_at should be nudged
 * now. Spec decision #3:
 *   last_session_at < now-7d AND last_session_at >= now-60d
 *   AND (last_intervention_at IS NULL OR last_intervention_at < now-14d)
 */
export function shouldNudge(
  lastSessionAt: string | null,
  lastInterventionAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!lastSessionAt) return false;
  const last = new Date(lastSessionAt).getTime();
  if (Number.isNaN(last)) return false;
  const t = now.getTime();

  const lapsedCutoff = t - LAPSED_DAYS * MS_PER_DAY;
  const capCutoff = t - CAP_DAYS * MS_PER_DAY;
  // "7+ days lapsed" → exactly 7 days ago is eligible (inclusive).
  if (!(last <= lapsedCutoff && last >= capCutoff)) return false;

  if (lastInterventionAt) {
    const intervention = new Date(lastInterventionAt).getTime();
    if (!Number.isNaN(intervention)) {
      const cooldownCutoff = t - COOLDOWN_DAYS * MS_PER_DAY;
      if (intervention >= cooldownCutoff) return false; // within cooldown
    }
  }
  return true;
}

/**
 * Run the full re-engagement batch. Idempotent + resumable. No new table/event
 * (spec decision #2); reuses `retention_signals` + the existing
 * `retention.intervention_triggered` event.
 */
export async function runReengagementNudge(): Promise<ReengageResult> {
  // Master gate (spec decision #6): no-op (logged) when automation is off.
  const automationOn = await isFeatureEnabled("automation_enabled");
  const retentionOn = await isFeatureEnabled("retention_automation_enabled");
  if (!automationOn || !retentionOn) {
    logError("reengagement-nudge: skipped (automation gated off)", null, {
      tag: "retention-nudge",
      automation_enabled: automationOn,
      retention_automation_enabled: retentionOn,
    });
    return { detected: 0, nudged: 0, skipped: 0 };
  }

  // admin: cron-driven endpoint — no user session; paginates all students
  // cross-user (issue #523). RLS would deny reading every student's signals.
  const supabase = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const idempotencyKey = `reengagement-nudge-${now.toISOString().slice(0, 10)}`;

  // Paginate the detection query (PostgREST caps at ~1000 rows; audit H9).
  // Filter at the DB for the time window (cheap), then apply the cooldown
  // predicate in JS (last_intervention_at may be NULL → OR clause).
  const lapsedIso = new Date(now.getTime() - LAPSED_DAYS * MS_PER_DAY).toISOString();
  const capIso = new Date(now.getTime() - CAP_DAYS * MS_PER_DAY).toISOString();

  const lapsed: LapsedStudent[] = [];
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from("retention_signals")
      .select("student_id, last_session_at, last_intervention_at")
      .lte("last_session_at", lapsedIso)
      .gte("last_session_at", capIso)
      .order("student_id", { ascending: true })
      .range(from, from + CHUNK - 1)
      .returns<(LapsedStudent & { last_intervention_at: string | null })[]>();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const s of data) {
      if (shouldNudge(s.last_session_at, s.last_intervention_at, now)) {
        lapsed.push({ student_id: s.student_id, last_session_at: s.last_session_at });
      }
    }
    if (data.length < CHUNK) break;
  }

  if (lapsed.length === 0) {
    await writeCompletionMarker(supabase, idempotencyKey, nowIso, 0, 0);
    return { detected: 0, nudged: 0, skipped: 0 };
  }

  let nudged = 0;
  let skipped = 0;

  // Process in chunks so each fan-out batch is bounded (audit H9 pattern).
  for (const group of chunk(lapsed, CHUNK)) {
    await Promise.allSettled(
      group.map(async (student) => {
        try {
          await nudgeOneStudent(supabase, student.student_id, now);
          nudged += 1;
        } catch (err) {
          // A single student's failure must not abort the batch. The stamp is
          // the resumable dedupe — if it failed, this student will be retried
          // next run (still within the cooldown-safe predicate).
          skipped += 1;
          logError("reengagement-nudge: student dispatch failed", err, {
            tag: "retention-nudge",
            studentId: student.student_id,
          });
        }
      }),
    );
  }

  // Completion marker (spec decision #4): written AFTER the batch so a partial
  // failure doesn't suppress same-day retries. Status reflects whether the
  // whole batch dispatched cleanly.
  await writeCompletionMarker(
    supabase,
    idempotencyKey,
    nowIso,
    nudged,
    skipped,
  );

  return { detected: lapsed.length, nudged, skipped };
}

/**
 * Dispatch the nudge for one student: build personalized copy, send in-app +
 * push (both gated on the same prefs/quiet-hours), then stamp the cooldown.
 * Exported for direct unit testing.
 */
export async function nudgeOneStudent(
  supabase: ReturnType<typeof createAdminClient>,
  studentId: string,
  _now: Date,
): Promise<void> {
  // Fetch the student's last progress row for copy personalization.
  const { data: progress } = await supabase
    .from("student_progress")
    .select("surah_to, ayah_to")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .range(0, 0)
    .returns<StudentProgress[]>()
    .maybeSingle();

  const copy = buildNudgeCopy(progress ?? null);

  // Fetch prefs to gate the push channel on the same quiet-hours rule the
  // dispatcher uses (spec risk: raw push bypasses communication_preferences).
  const { data: prefs } = await supabase
    .from("communication_preferences")
    .select("in_app_enabled, quiet_hours_start, quiet_hours_end, important_only_mode")
    .eq("user_id", studentId)
    .maybeSingle<PrefsRow>();

  const inQuietHours = userInQuietHours(prefs);
  const importantOnly = prefs?.important_only_mode ?? false;
  const inAppEnabled = prefs?.in_app_enabled ?? true;

  // In-app notify() already enforces quiet hours + important-only for
  // non-urgent; we pass urgent:false so it respects both. The nudge is
  // explicitly non-urgent (it's encouragement, not an ops alert).
  if (inAppEnabled && !importantOnly && !inQuietHours) {
    await notify({
      userId: studentId,
      type: "reminder",
      title: copy.title,
      body: copy.body,
      urgent: false,
      entityType: "student",
      entityId: studentId,
      data: { source: "reengagement_nudge" },
    });
  }

  // Push: gated on the SAME prefs/quiet-hours (spec risk #1). No dedicated
  // push opt-out column exists (OPEN DECISION resolved: reuse in_app_enabled +
  // quiet hours). Only push when in-app would also fire.
  if (inAppEnabled && !importantOnly && !inQuietHours) {
    // sendPushToUser is fire-and-forget-safe (logs + prunes internally). Don't
    // await-blocking the stamp on push success — in-app is the primary channel.
    void sendPushToUser(studentId, {
      title: copy.title,
      body: copy.body,
      url: "/student/dashboard",
      tag: "reengagement-nudge",
    });
  }

  // Stamp the cooldown AFTER dispatch so a mid-failure retry skips this
  // student (spec decision #4 — the stamp IS the resumable dedupe).
  const { error: stampErr } = await supabase
    .from("retention_signals")
    .update({
      last_intervention_at: new Date().toISOString(),
      intervention_type: "reengagement_7d",
    })
    .eq("student_id", studentId);
  if (stampErr) {
    // Don't swallow — surface so the caller's try/catch counts it as skipped
    // and the student is retried next run.
    throw new Error(`stamp failed for ${studentId}: ${stampErr.message}`);
  }

  // Reuse the existing event (spec decision #2 — no new event). Gated by
  // retention_automation_enabled in the WEBHOOK_ROUTES map.
  void emitEvent(
    "retention.intervention_triggered",
    "student",
    studentId,
    { intervention_type: "reengagement_7d" },
    null,
  );
}

/**
 * Write the daily completion marker. NOT a start-gate (spec decision #4). If a
 * `running`/failed marker already exists for today, we still write a fresh
 * `succeeded` row on a clean finish — the marker is observability, not a lock.
 */
async function writeCompletionMarker(
  supabase: ReturnType<typeof createAdminClient>,
  idempotencyKey: string,
  startedAtIso: string,
  nudged: number,
  skipped: number,
): Promise<void> {
  const status = skipped === 0 ? "succeeded" : "succeeded_with_skips";
  const { error } = await supabase.from("automation_logs").insert({
    workflow_name: "reengagement-nudge",
    event_name: "retention.intervention_triggered",
    entity_type: "batch",
    idempotency_key: idempotencyKey,
    payload_json: { nudged, skipped },
    result_json: { nudged, skipped },
    status,
    started_at: startedAtIso,
    finished_at: new Date().toISOString(),
  });
  if (error) {
    // Observability-only — don't fail the run because the marker write failed.
    logError("reengagement-nudge: completion marker insert failed", error, {
      tag: "retention-nudge",
      idempotencyKey,
    });
  }
}
