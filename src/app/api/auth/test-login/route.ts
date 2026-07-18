import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import type { TableInsert } from "@/lib/supabase/typed-helpers";

export const dynamic = "force-dynamic";

/**
 * TEST-ONLY login endpoint. Mints a real Supabase session cookie for a seeded
 * test user so black-box API test runners (Playwright, CI) can exercise
 * authenticated routes.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THIS ENDPOINT MUST NEVER BE REACHABLE IN PRODUCTION. Defense in depth:
 *   1. `NODE_ENV === "production"`  → 404 (Vercel prod + any prod build)
 *   2. `process.env.VERCEL` is set  → 404 (every Vercel deploy, incl. preview)
 *   3. `ALLOW_TEST_LOGIN !== "true"` → 404 (explicit local opt-in required)
 *   4. `TEST_LOGIN_SECRET` unset     → 404 (no secret configured = disabled)
 *   5. `x-test-login-secret` header must match `TEST_LOGIN_SECRET` (constant-time)
 *
 * Any gate failure returns 404 (not 401/403) so the route's existence is not
 * disclosed when disabled. All four env gates must independently pass before
 * the secret is even compared — a single one closes the door.
 * ──────────────────────────────────────────────────────────────────────────
 */

type TestRole = "student" | "teacher" | "admin";
const VALID_ROLES: readonly TestRole[] = ["student", "teacher", "admin"];

// Keyed by the three live roles only (moderator was dropped per ADR-0003 but
// still lingers in the generated user_role enum, so we don't use Record<UserRole>).
const DEFAULT_EMAIL_BY_ROLE: Record<"student" | "teacher" | "admin", string> = {
  student: "test-student@furqan.test",
  teacher: "test-teacher@furqan.test",
  admin: "test-admin@furqan.test",
};

function testLoginEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL) return false;
  if (process.env.ALLOW_TEST_LOGIN !== "true") return false;
  if (!process.env.TEST_LOGIN_SECRET) return false;
  return true;
}

function secretMatches(provided: string | null): boolean {
  const expected = process.env.TEST_LOGIN_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  // Gate 1-4: env opt-in. Indistinguishable-from-not-existing when disabled.
  if (!testLoginEnabled()) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  // Gate 5: shared secret, constant-time.
  if (!secretMatches(request.headers.get("x-test-login-secret"))) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  // Parse and validate the requested identity.
  let body: { email?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const role: TestRole =
    typeof body.role === "string" && VALID_ROLES.includes(body.role as TestRole)
      ? (body.role as TestRole)
      : "student";

  // Only accept test domain emails to prevent overwriting real profiles.
  const email =
    typeof body.email === "string" && body.email.endsWith("@furqan.test")
      ? body.email.toLowerCase()
      : DEFAULT_EMAIL_BY_ROLE[role];

  // admin: dev/test route; auth.admin API (issue #523)
  const admin = createAdminClient();

  // 1. Find-or-create the auth user. createUser with email_confirm:true is
  //    idempotent enough for tests — on "already registered" we look it up.
  let userId: string | null = null;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { test_user: true, seeded_role: role },
  });

  if (created?.user) {
    userId = created.user.id;
  } else if (createErr) {
    // Already exists → page through and match by email.
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) {
      logError("test-login: listUsers failed", listErr, { tag: "test-login" });
      return NextResponse.json({ error: "user_lookup_failed" }, { status: 500 });
    }
    userId = list.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
  }

  if (!userId) {
    logError("test-login: could not resolve user id", createErr ?? new Error("no-user"), {
      tag: "test-login",
      email,
    });
    return NextResponse.json({ error: "user_create_failed" }, { status: 500 });
  }

  // 2. Ensure the profile row exists with the correct role and is_test_account flag.
  //    INSERT first so new accounts get is_test_account:true stamped at birth.
  //    On conflict (existing account), only update role/roles — never overwrite
  //    is_test_account on a row we didn't create, preserving its current flag.
  //    `profiles` has CHECK (role = ANY(roles)) — both must be set together.
  const profileRow: TableInsert<"profiles"> = {
    id: userId,
    role,
    roles: [role],
    is_test_account: true,
  };
  const { error: insertErr } = await admin.from("profiles").insert(profileRow);
  if (insertErr) {
    if (insertErr.code !== "23505") {
      logError("test-login: profile insert failed", insertErr, { tag: "test-login", userId, role });
      return NextResponse.json({ error: "profile_upsert_failed" }, { status: 500 });
    }
    const { error: updateErr } = await admin
      .from("profiles")
      .update({ role, roles: [role] })
      .eq("id", userId);
    if (updateErr) {
      logError("test-login: profile update failed", updateErr, { tag: "test-login", userId, role });
      return NextResponse.json({ error: "profile_upsert_failed" }, { status: 500 });
    }
  }

  // 3. Mint a magic-link token and verify it through the SSR client, which
  //    writes the auth cookies — the exact mechanism /auth/confirm uses.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    logError("test-login: generateLink failed", linkErr ?? new Error("no-token"), {
      tag: "test-login",
      email,
    });
    return NextResponse.json({ error: "link_generation_failed" }, { status: 500 });
  }

  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr) {
    logError("test-login: verifyOtp failed", verifyErr, { tag: "test-login", email });
    return NextResponse.json({ error: "session_establish_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId, email, role });
}
