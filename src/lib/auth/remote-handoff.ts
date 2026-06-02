"use server";

/**
 * Remote handoff: lets an admin signed in on desktop hand off a fresh
 * authenticated session to their phone via QR code or short URL.
 *
 * Flow:
 *   1. Desktop calls `requestHandoff({ targetPath })` → mints a one-time
 *      code, mints a Supabase magic link, stores SHA-256(code) +
 *      hashed_token in `remote_handoff_tokens`, returns the QR SVG + URL.
 *   2. Phone hits `/api/auth/handoff/<code>` → atomically claims the row,
 *      302s to `/auth/confirm?token_hash=...&type=magiclink&next=...`.
 *   3. `/auth/confirm` calls supabase.auth.verifyOtp(...) which sets the
 *      auth cookies on the phone, then 302s to `next`.
 *
 * The phone never sees the raw token_hash; the raw `code` is one-shot and
 * expires in 5 minutes. See migration `20260503195950_add_remote_handoff_tokens.sql`.
 */

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import * as QRCode from "qrcode";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

const HANDOFF_TTL_MS = 5 * 60 * 1000;
const TARGET_PATH_MAX_LEN = 200;

export type RequestHandoffInput = { targetPath: string };
export type RequestHandoffResult =
  | { ok: true; qrSvg: string; url: string; expiresAt: string }
  | { ok: false; error: string };

export type ConsumeHandoffResult =
  | { ok: true; tokenHash: string; nextPath: string }
  | { ok: false; status: 404 | 410 | 500; error: string };

// ---------------------------------------------------------------------------
// TODO(human): implement validateTargetPath
//
// Contract: this is the LAST line of defense before a `target_path` value
// gets stored in the DB and (later) used as the redirect target after
// magic-link verification. The migration adds a CHECK constraint at the
// storage layer; this function is the application-layer twin.
//
// Signature:
//   function validateTargetPath(rawPath: string):
//     | { ok: true; path: string }   // `path` is the cleaned/normalized value to store
//     | { ok: false; error: string } // user-facing Arabic error
//
// Threats this must defend against:
//   - Open redirect (e.g. `//evil.com/`, `/\\evil.com`, `https://evil.com`)
//   - Path traversal (`/admin/..`, `/admin/../../auth/login`)
//   - Header injection / response splitting (CR, LF, NULL bytes)
//   - Very long paths that bloat the DB / log lines (cap to TARGET_PATH_MAX_LEN)
//   - Anything that doesn't actually start under `/admin/` (the only
//     surface the remote handoff feature is approved for in this iteration)
//
// Hints:
//   - Reject if `rawPath` doesn't start with '/admin/' (note the trailing slash —
//     '/adminbypass' must fail)
//   - Reject if it starts with '//' (protocol-relative URL trick)
//   - Reject if it contains '\r', '\n', '\x00', or '\\'
//   - Reject if it contains '..' segments
//   - Length cap via TARGET_PATH_MAX_LEN
//   - Return Arabic error messages so the modal feedback is consistent with
//     the rest of the admin surface
// ---------------------------------------------------------------------------
function validateTargetPath(rawPath: string): { ok: true; path: string } | { ok: false; error: string } {
  const path = rawPath.trim();
  if (path.length === 0 || path.length > TARGET_PATH_MAX_LEN) {
    return { ok: false, error: "طول المسار غير صالح." };
  }
  if (/[\r\n\x00\\]/.test(path)) {
    return { ok: false, error: "المسار يحتوي على رموز غير صالحة." };
  }
  if (path.startsWith("//")) {
    return { ok: false, error: "المسار غير مسموح به." };
  }
  if (path.split("/").includes("..")) {
    return { ok: false, error: "المسار يحتوي على تنقل غير مسموح." };
  }
  if (!path.startsWith("/admin/")) {
    return { ok: false, error: "المسار يجب أن يبدأ بـ /admin/." };
  }
  return { ok: true, path };
}
// ---------------------------------------------------------------------------

function newCode(): string {
  // 18 bytes → 24-char base64url string. ~144 bits of entropy.
  return randomBytes(18).toString("base64url");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function publicHandoffUrl(code: string): string {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${baseUrl}/api/auth/handoff/${code}`;
}

const requestHandoffSchema = z.object({ targetPath: z.string().min(1).max(TARGET_PATH_MAX_LEN) });

/**
 * Server action — desktop calls this when the admin clicks "Open on phone".
 * Mints a one-time handoff code + Supabase magic link, returns SVG + URL +
 * expiry. The magic link's hashed_token is stored server-side; the phone
 * never sees it.
 */
export async function requestHandoff(input: RequestHandoffInput): Promise<RequestHandoffResult> {
  Sentry.addBreadcrumb?.({ category: "auth", level: "info", message: "remote-handoff.request" });
  Sentry.setTag?.("action.name", "admin.remote-handoff.request");

  const parsed = requestHandoffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(" • ") };
  }

  let adminId: string;
  try {
    const r = await requireAdmin();
    adminId = r.id;
  } catch {
    return { ok: false, error: "صلاحية المشرف مطلوبة." };
  }

  const validated = validateTargetPath(parsed.data.targetPath);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();

  // Resolve admin's email — `auth.admin.getUserById` bypasses RLS and returns
  // { data: { user }, error }. Email may be null for OAuth-only accounts.
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(adminId);
  if (userErr) {
    logError("remote-handoff: getUserById failed", userErr, { tag: "remote-handoff" });
    return { ok: false, error: "تعذّر جلب بيانات المشرف." };
  }
  const email = userData.user?.email ?? null;
  if (!email) {
    return { ok: false, error: "لا يمكن إنشاء رمز هاتف لأن البريد الإلكتروني للمشرف غير مسجل." };
  }

  // Rate limit: one active code at a time per admin. Forces explicit revoke
  // before re-issuing, and stops a runaway loop minting magic links.
  const { count: activeCount, error: countErr } = await admin.from("remote_handoff_tokens")
    .select("id", { count: "exact", head: true })
    .eq("admin_user_id", adminId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());
  if (countErr) {
    logError("remote-handoff: rate-limit query failed", countErr, { tag: "remote-handoff" });
    return { ok: false, error: "تعذّر التحقق من الرموز النشطة." };
  }
  if ((activeCount ?? 0) > 0) {
    return { ok: false, error: "يوجد رمز هاتف نشط بالفعل. ألغِه أو انتظر انتهاء صلاحيته." };
  }

  // Mint the Supabase magic link. action_link is consumed server-side at the
  // /auth/confirm route, never sent to the phone.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: validated.path },
  });
  if (linkErr) {
    logError("remote-handoff: generateLink failed", linkErr, { tag: "remote-handoff" });
    return { ok: false, error: `تعذّر إنشاء رابط الدخول: ${linkErr.message}` };
  }
  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) {
    return { ok: false, error: "Supabase لم يُرجع رمز التحقق." };
  }

  const code = newCode();
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString();

  const { error: insertErr } = await admin.from("remote_handoff_tokens").insert({
    code_hash: hashCode(code),
    admin_user_id: adminId,
    target_path: validated.path,
    supabase_token_hash: tokenHash,
    expires_at: expiresAt,
  } satisfies TableInsert<"remote_handoff_tokens">);
  if (insertErr) {
    logError("remote-handoff: insert failed", insertErr, { tag: "remote-handoff" });
    return { ok: false, error: "تعذّر تخزين الرمز." };
  }

  const url = publicHandoffUrl(code);
  let qrSvg: string;
  try {
    qrSvg = await QRCode.toString(url, {
      type: "svg",
      margin: 1,
      width: 256,
      color: { dark: "#0a0a0a", light: "#ffffff" },
    });
  } catch (qrErr) {
    logError("remote-handoff: QR render failed", qrErr, { tag: "remote-handoff" });
    return { ok: false, error: "تعذّر إنشاء رمز QR." };
  }

  return { ok: true, qrSvg, url, expiresAt };
}

/**
 * Server action — admin can revoke their own active handoff codes (e.g.
 * dropped phone, lost the modal). Marks any unexpired-unused rows as used.
 */
export async function revokeMyHandoffs(): Promise<{ ok: boolean; revoked: number }> {
  let adminId: string;
  try {
    const r = await requireAdmin();
    adminId = r.id;
  } catch {
    return { ok: false, revoked: 0 };
  }
  const admin = createAdminClient();
  const { count, error } = await admin.from("remote_handoff_tokens")
    .update({ used_at: new Date().toISOString(), used_ua: "self-revoke" } satisfies TableUpdate<"remote_handoff_tokens">, { count: "exact" })
    .eq("admin_user_id", adminId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());
  if (error) {
    logError("remote-handoff: revoke failed", error, { tag: "remote-handoff" });
    return { ok: false, revoked: 0 };
  }
  return { ok: true, revoked: count ?? 0 };
}

/**
 * Used by the route handler at /api/auth/handoff/[code]. Atomically claims
 * the row (used_at = now() where used_at is null) so a replay returns 410.
 * Logs the request IP + UA on the row for forensics.
 */
export async function consumeHandoff(rawCode: string, ip: string | null, ua: string | null): Promise<ConsumeHandoffResult> {
  if (!rawCode || rawCode.length < 10 || rawCode.length > 200) {
    return { ok: false, status: 404, error: "رمز غير صالح." };
  }
  const codeHash = hashCode(rawCode);
  const admin = createAdminClient();

  // Single atomic update — `update ... where ... is null returning *` so a
  // racing second hit returns zero rows. Filtering on expires_at > now()
  // prevents claim of an expired row even if the cleanup cron is late.
  const { data, error } = await admin.from("remote_handoff_tokens")
    .update({
      used_at: new Date().toISOString(),
      used_ip: ip,
      used_ua: ua,
    } satisfies TableUpdate<"remote_handoff_tokens">)
    .eq("code_hash", codeHash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("supabase_token_hash, target_path")
    .single<{ supabase_token_hash: string; target_path: string }>();

  if (error || !data) {
    // Don't distinguish "no such code" from "already used / expired" in the
    // error body — that would let an attacker probe whether a code existed.
    return { ok: false, status: 410, error: "الرمز منتهي أو مستخدم." };
  }

  return { ok: true, tokenHash: data.supabase_token_hash, nextPath: data.target_path };
}
