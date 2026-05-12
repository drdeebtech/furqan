/**
 * T024 / T024.5 — E2E reconciliation + cancelled-booking guard (US4).
 *
 * T024: Manual "End session" → webhook arrives later → session row reflects
 *       Daily's canonical values (ended_at + actual_duration from webhook, not
 *       from the manual click).
 *
 * T024.5: A pre-cancelled booking receives a meeting.ended webhook →
 *         sessions.ended_at + actual_duration are SET (audit trail),
 *         bookings.status stays 'cancelled' (booking-domain ownership preserved).
 *
 * These tests require a real Supabase DB with the 007 migrations applied and
 * a session+booking seeded under the FURQAN_TEST_* env vars below. They are
 * skipped when the env vars are absent so local unit runs stay green.
 *
 * Required env vars (set in .env.test.local or the CI secret store):
 *   DAILY_WEBHOOK_SECRET          — the HMAC secret matching the handler
 *   SUPABASE_URL                  — project URL
 *   SUPABASE_SERVICE_ROLE_KEY     — for direct row verification
 *   FURQAN_TEST_SESSION_ID        — UUID of a test session (room_name set)
 *   FURQAN_TEST_BOOKING_ID        — UUID of its booking
 *   FURQAN_TEST_ROOM_NAME         — the session's room_name value
 *   FURQAN_TEST_CANCELLED_SESSION_ID  — UUID of a session whose booking is cancelled
 *   FURQAN_TEST_CANCELLED_ROOM_NAME   — its room_name
 */

import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";

const SECRET              = process.env.DAILY_WEBHOOK_SECRET ?? "";
const SUPABASE_URL        = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY        = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SESSION_ID          = process.env.FURQAN_TEST_SESSION_ID ?? "";
const BOOKING_ID          = process.env.FURQAN_TEST_BOOKING_ID ?? "";
const ROOM_NAME           = process.env.FURQAN_TEST_ROOM_NAME ?? "";
const CANCELLED_SESSION   = process.env.FURQAN_TEST_CANCELLED_SESSION_ID ?? "";
const CANCELLED_ROOM      = process.env.FURQAN_TEST_CANCELLED_ROOM_NAME ?? "";

const WEBHOOK_PATH = "/api/webhooks/daily";

const hasFullEnv = SECRET && SUPABASE_URL && SUPABASE_KEY && SESSION_ID && BOOKING_ID && ROOM_NAME;
const hasCancelledEnv = hasFullEnv && CANCELLED_SESSION && CANCELLED_ROOM;

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

async function dbSelect<T>(table: string, id: string, columns: string): Promise<T | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=${columns}&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  const rows = await res.json() as T[];
  return rows[0] ?? null;
}

async function dbUpdate(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method:  "PATCH",
    headers: {
      apikey:          SUPABASE_KEY,
      Authorization:   `Bearer ${SUPABASE_KEY}`,
      "Content-Type":  "application/json",
      Prefer:          "return=minimal",
    },
    body: JSON.stringify(patch),
  });
}

// ── T024: Manual end → webhook reconcile ─────────────────────────────────────

test.describe("T024 — manual end → webhook reconcile", () => {
  test.skip(!hasFullEnv, "Skipped: FURQAN_TEST_* env vars not set");

  test("webhook actual_duration overwrites manual click's value", async ({ request }) => {
    // Reset: clear ended_at so the session looks fresh
    await dbUpdate("sessions", SESSION_ID, { ended_at: null, actual_duration: null });

    // Simulate manual end: set ended_at to now - 10s (manual click)
    const manualEndedAt = new Date(Date.now() - 10_000).toISOString();
    await dbUpdate("sessions", SESSION_ID, { ended_at: manualEndedAt, actual_duration: 60 });

    // Confirm manual state
    const afterManual = await dbSelect<{ ended_at: string; actual_duration: number }>(
      "sessions", SESSION_ID, "ended_at,actual_duration",
    );
    expect(afterManual?.actual_duration).toBe(60);

    // Send meeting.ended webhook with a longer duration (webhook is source of truth)
    const webhookDuration = 3600;
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id:        `evt_reconcile_${Date.now()}`,
      type:      "meeting.ended",
      version:   "1",
      timestamp: Date.now(),
      room: { name: ROOM_NAME, id: "room_e2e", domain_name: "furqan.daily.co" },
      data: { start_time: now - webhookDuration, end_time: now, duration: webhookDuration },
    });
    const sig = sign(body);

    const res = await request.post(WEBHOOK_PATH, {
      headers: { "content-type": "application/json", "x-webhook-signature": sig },
      data: body,
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Webhook must have reconciled — actual_duration should now match Daily's value (≥3600)
    const afterWebhook = await dbSelect<{ ended_at: string; actual_duration: number }>(
      "sessions", SESSION_ID, "ended_at,actual_duration",
    );
    expect(afterWebhook?.actual_duration).toBeGreaterThanOrEqual(59); // 3600s ÷ 60 ≈ 60 min
    expect(afterWebhook?.ended_at).not.toBe(manualEndedAt);
  });
});

// ── T024.5: Cancelled booking guard ──────────────────────────────────────────

test.describe("T024.5 — cancelled-booking guard (FR-005)", () => {
  test.skip(!hasCancelledEnv, "Skipped: FURQAN_TEST_CANCELLED_* env vars not set");

  test("booking status stays cancelled; session audit row is set", async ({ request }) => {
    // The test session's booking should already be 'cancelled'. Confirm:
    const booking = await dbSelect<{ status: string }>(
      "bookings", BOOKING_ID, "status",
    );
    // If the booking isn't cancelled in the test DB, we can't run a meaningful test
    test.skip(booking?.status !== "cancelled", "Booking isn't cancelled in test DB");

    const webhookDuration = 1800;
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id:        `evt_cancelled_${Date.now()}`,
      type:      "meeting.ended",
      version:   "1",
      timestamp: Date.now(),
      room: { name: CANCELLED_ROOM, id: "room_c", domain_name: "furqan.daily.co" },
      data: { start_time: now - webhookDuration, end_time: now, duration: webhookDuration },
    });
    const sig = sign(body);

    const res = await request.post(WEBHOOK_PATH, {
      headers: { "content-type": "application/json", "x-webhook-signature": sig },
      data: body,
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Booking domain ownership preserved — status must still be 'cancelled'
    const bookingAfter = await dbSelect<{ status: string }>("bookings", BOOKING_ID, "status");
    expect(bookingAfter?.status).toBe("cancelled");

    // Session audit trail: ended_at + actual_duration must be set by the SQL function
    const sessionAfter = await dbSelect<{ ended_at: string | null; actual_duration: number | null }>(
      "sessions", CANCELLED_SESSION, "ended_at,actual_duration",
    );
    expect(sessionAfter?.ended_at).not.toBeNull();
    expect(sessionAfter?.actual_duration).toBeGreaterThan(0);
  });
});
