# Security Review — furqan — 2026-05-04

Static review of the FURQAN Academy codebase (Next.js 16 + Supabase + Vercel + n8n) on branch `feat/admin-control-tower-remote-session`. Read-only audit — no fixes applied. Each finding includes file:line, vulnerability class, severity, confidence, exploit scenario, and a concrete patch diff.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0     |
| **High** | **3** |
| Medium   | 2     |
| Low      | 2     |
| **Total**| **7** |

The codebase shows mature security hygiene in many places — `safeCompareSecret` for shared secrets in 8 of 9 endpoints; correct use of `getUser()` (not `getSession()`) in middleware; a custom auth-cookie shape filter; rate limiting on auth flows; password strength enforcement; redirect-target validation on the Google OAuth callback and login redirect; CSP/HSTS/X-Frame/Permissions-Policy headers; service worker that excludes `/api/*` from caching; admin-only `loudAction` wrapper with audit logging; `"server-only"` tagging on the service-role client; and Sentry PII redaction triggers in Postgres. The findings below are exceptions to that baseline.

## Findings

---

### [HIGH] IDOR — Any teacher can write evaluations for any student
- **File:** `src/lib/actions/evaluations.ts:71-123`
- **Class:** Authorization (BOLA / IDOR)
- **Confidence:** High
- **Exploit:** A logged-in user with the `teacher` role calls `createTeacherEvaluation(victimStudentId, ...)`. The function only verifies the caller's *role*, never that they have any teaching relationship with the named student. The insert sets `evaluator_id` and `teacher_id` to `user.id` but takes `student_id` straight from the argument, so the attacker writes a `session_evaluations` row with arbitrary scores against any student. The student is then notified ("تقييم جديد من معلمك") from a teacher who never taught them. Compare with `createHomework` (`src/lib/actions/homework.ts:62-74`), which correctly verifies booking ownership before write.
- **Patch:**
```diff
@@ src/lib/actions/evaluations.ts
   if (!profile || !["admin", "moderator", "teacher"].includes(profile.role)) {
     return { error: "ليس لديك صلاحية" };
   }
+
+  // Teachers may only evaluate students they actually teach.
+  // Admin / moderator can evaluate anyone (existing semantics).
+  if (profile.role === "teacher") {
+    const { data: relation } = await supabase
+      .from("bookings")
+      .select("id")
+      .eq("teacher_id", user.id)
+      .eq("student_id", studentId)
+      .limit(1);
+    if (!relation || relation.length === 0) {
+      return { error: "لا يمكنك تقييم طالب لم تُدرّسه" };
+    }
+  }
+
   const { error } = await supabase.from("session_evaluations").insert({
```

---

### [HIGH] Stripe webhook accepts unsigned payloads once env vars are set (time-bomb)
- **File:** `src/app/api/stripe/webhook/route.ts:38-67`
- **Class:** Authentication (signature bypass) → Payment fraud
- **Confidence:** High
- **Exploit:** Today the route 503s because `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are unset. The signature verification block is commented out (TODO Sprint 1). The moment those env vars are added — which `CLAUDE.md` flags as imminent — every condition in the guard becomes truthy and the route falls through to `JSON.parse(body)` and `fulfillPackagePurchase(...)` with no signature check. An anonymous attacker can `POST /api/stripe/webhook` with `{type:"checkout.session.completed", data:{object:{metadata:{user_id, package_id}, payment_intent:"x", amount_total:0, currency:"USD"}}}` and have a paid package granted to any user_id without paying. The current "env not set → 503" gate is the only thing protecting the route, and it is silently revoked on env-var change.
- **Patch (immediate — closes the door without needing the SDK):**
```diff
@@ src/app/api/stripe/webhook/route.ts
 export async function POST(request: Request) {
-  // Stripe is deferred until keys are provisioned. Reject early so unconfigured
-  // production traffic doesn't spawn fulfillment logic on un-verifiable payloads.
-  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
-    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
-  }
-
-  const body = await request.text();
-
-  // TODO(Sprint 1): Verify Stripe signature
-  // ... (commented block)
-
-  // Until Stripe SDK is installed, accept the raw JSON payload.
-  let event: { type: string; data: { object: Record<string, unknown> } };
-  try {
-    event = JSON.parse(body);
-  } catch {
-    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
-  }
+  // Hard-disabled until the Stripe SDK is wired and signatures are verified.
+  // Returning 501 (not 503) so a future dev who installs the SDK is forced
+  // to delete this guard rather than accidentally re-enable it by setting
+  // env vars.
+  return NextResponse.json({ error: "Stripe webhook not implemented" }, { status: 501 });
```
**Patch (proper, when Stripe SDK is wired):**
```diff
+import Stripe from "stripe";
@@
+  const sig = request.headers.get("stripe-signature");
+  const secret = process.env.STRIPE_WEBHOOK_SECRET;
+  const apiKey = process.env.STRIPE_SECRET_KEY;
+  if (!sig || !secret || !apiKey) {
+    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
+  }
+  const body = await request.text();
+  const stripe = new Stripe(apiKey);
+  let event: Stripe.Event;
+  try {
+    event = stripe.webhooks.constructEvent(body, sig, secret);
+  } catch {
+    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
+  }
```

---

### [HIGH] IDOR — Any teacher can read any session's parent narrative + trigger send
- **File:** `src/app/api/reports/session/[id]/route.ts:42-46` (read), `src/app/api/reports/session/[id]/send/route.ts:40-49` (send)
- **Class:** Authorization (BOLA / IDOR) → PII disclosure + spam
- **Confidence:** High
- **Exploit:** With a logged-in `teacher` cookie session, GET `/api/reports/session/<arbitrary-uuid>` and the structured parent-facing narrative (recitation errors, evaluation, full session details) for any other teacher's student is returned. The role check accepts any teacher; there is no predicate that ties the session to the caller. The same role gate guards `…/send/route.ts`, so any teacher can also *trigger an email/WhatsApp to a stranger's parent* with attacker-supplied `narrative_paragraph` text via the optional body. Iterating UUIDs is slow but feasible; UUIDs also leak via DOM attributes, automation_logs, and email links.
- **Patch (apply to BOTH routes):**
```diff
@@ src/app/api/reports/session/[id]/route.ts (and …/send/route.ts)
     if (!actor || !["admin", "moderator", "teacher"].includes(actor.role)) {
       return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
     }
+
+    // Teachers may only act on sessions they actually taught. Admin/moderator
+    // are exempt — they have a legitimate read across the platform.
+    if (actor.role === "teacher") {
+      const { data: ownership } = await supabase
+        .from("sessions")
+        .select("id, bookings!inner(teacher_id)")
+        .eq("id", id)
+        .eq("bookings.teacher_id", user.id)
+        .maybeSingle();
+      if (!ownership) {
+        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
+      }
+    }
   }
```

---

### [MEDIUM] Non-timing-safe bearer compare on sentry-watch endpoint
- **File:** `src/app/api/sentry-watch/notify/route.ts:38-42`
- **Class:** Cryptography (timing oracle on shared secret)
- **Confidence:** High
- **Exploit:** The endpoint sends a WhatsApp message to the admin when a bearer token matches. The comparison is `if (presented !== expected)` — a string-equality short-circuit that leaks per-byte timing information over the network. An attacker can recover `SENTRY_WATCH_SECRET` byte-by-byte by measuring 401 latencies (the same class of attack `safeCompareSecret` was added to defeat — see `src/lib/security/secrets.ts:10`, used correctly by every other webhook in the repo). Once recovered, the attacker controls the admin's WhatsApp triage channel.
- **Patch:**
```diff
@@ src/app/api/sentry-watch/notify/route.ts
 import { sendWhatsAppNotification } from "@/lib/whatsapp";
 import { logError } from "@/lib/logger";
+import { safeCompareSecret } from "@/lib/security/secrets";
@@
   const auth = req.headers.get("authorization") ?? "";
   const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
-  if (presented !== expected) {
+  if (!safeCompareSecret(presented, expected)) {
     return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
   }
```

---

### [MEDIUM] BotID fail-open on login / register / teach-apply
- **File:** `src/app/(auth)/actions.ts:104` (login), `src/app/(auth)/actions.ts:215` (register), `src/app/(public)/teach/apply/actions.ts:91-93` (teach-apply)
- **Class:** Authentication (bot defense bypass)
- **Confidence:** Medium — needs manual verification of `botid@1.5.11` verdict semantics
- **Exploit:** These three flows check `if (verification.isBot)`, which only rejects when BotID is *confident* the request is a bot. If BotID returns an ambiguous / "unknown" verdict — common during partial network failures, novel automation, or geo edge cases — `isBot` is `false` and the request proceeds. The contact form (`src/app/(public)/contact/actions.ts:16`) already uses the correct fail-closed `if (!verification.isHuman)` shape. The asymmetry suggests the contact form pattern is intentional and the others are oversights. Impact: credential-stuffing throughput on `/login` (already gated by per-email rate limit, partial mitigation), spam accounts on `/register`, and spam teacher applications on `/teach/apply` (gated by per-IP throttle, partial mitigation).
- **Patch:**
```diff
@@ src/app/(auth)/actions.ts (login + register)
   const verification = await checkBotId();
-  if (verification.isBot) {
+  if (!verification.isHuman) {
@@ src/app/(public)/teach/apply/actions.ts
   const verification = await checkBotId();
-  if (verification.isBot) {
+  if (!verification.isHuman) {
     return { error: "تعذر التحقق من الطلب" };
   }
```

---

### [LOW] CSP allows `'unsafe-inline'` in `script-src`
- **File:** `vercel.json:13` (Content-Security-Policy header)
- **Class:** CORS / Headers (defense-in-depth)
- **Confidence:** Medium — no active XSS sink found in this review
- **Exploit:** No exploitable injection point was found, but `script-src 'self' 'unsafe-inline' …` means any future reflected-text-into-template bug that lands in a `<script>` tag becomes script execution. The directive exists for one inline script: the SW-registration in `src/app/layout.tsx:131-135`. Moving it to an external file lets `'unsafe-inline'` be dropped, hardening the page against an entire class of injection bugs.
- **Patch:**
```diff
@@ public/sw-register.js (new file)
+if ('serviceWorker' in navigator) {
+  window.addEventListener('load', () => {
+    navigator.serviceWorker.register('/sw.js').catch(() => {});
+  });
+}
@@ src/app/layout.tsx
-        <script
-          dangerouslySetInnerHTML={{
-            __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}`,
-          }}
-        />
+        <script src="/sw-register.js" defer />
@@ vercel.json
-          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://*.supabase.co https://*.daily.co https://js.stripe.com https://checkout.stripe.com; style-src 'self' 'unsafe-inline' …"
+          "value": "default-src 'self'; script-src 'self' https://*.supabase.co https://*.daily.co https://js.stripe.com https://checkout.stripe.com; style-src 'self' 'unsafe-inline' …"
```
Note: `style-src 'unsafe-inline'` is still required for Tailwind's runtime — leave it as-is.

---

### [LOW] n8n REST `id` interpolated into URL path without encoding
- **File:** `src/lib/n8n/client.ts:101, 105, 108, 138, 142`
- **Class:** Injection (URL path)
- **Confidence:** Low — admin-gated; needs manual verification
- **Exploit:** Functions like `activateWorkflow(id)` interpolate the parameter directly: ``await n8nFetch(`/workflows/${id}/activate`, …)``. A malicious `id` containing `?`, `#`, or `../` reaches the n8n REST API unmodified. Both consumer routes (`src/app/api/n8n/workflow/[id]/route.ts`, `…/execution/[id]/route.ts`) are gated by `requireAdminForApi`, so exploitation requires an authenticated admin — at which point the attacker already has the n8n control panel. Worst-case is that an admin-class XSS or open-redirect chain in the admin UI lands here and reaches an unintended n8n endpoint. Defense in depth.
- **Patch:**
```diff
@@ src/lib/n8n/client.ts
-export async function activateWorkflow(id: string): Promise<void> {
-  await n8nFetch(`/workflows/${id}/activate`, { method: "POST" });
-}
-
-export async function deactivateWorkflow(id: string): Promise<void> {
-  await n8nFetch(`/workflows/${id}/deactivate`, { method: "POST" });
-}
-
-export async function getWorkflowDetail(id: string): Promise<N8nWorkflowDetail> {
-  return n8nFetch<N8nWorkflowDetail>(`/workflows/${id}`);
-}
+export async function activateWorkflow(id: string): Promise<void> {
+  await n8nFetch(`/workflows/${encodeURIComponent(id)}/activate`, { method: "POST" });
+}
+
+export async function deactivateWorkflow(id: string): Promise<void> {
+  await n8nFetch(`/workflows/${encodeURIComponent(id)}/deactivate`, { method: "POST" });
+}
+
+export async function getWorkflowDetail(id: string): Promise<N8nWorkflowDetail> {
+  return n8nFetch<N8nWorkflowDetail>(`/workflows/${encodeURIComponent(id)}`);
+}
@@
-export async function getExecutionDetail(id: string): Promise<N8nExecutionDetail> {
-  return n8nFetch<N8nExecutionDetail>(`/executions/${id}?includeData=true`);
-}
-
-export async function getWorkflowExecutions(workflowId: string, limit = 50): Promise<N8nExecution[]> {
-  const res = await n8nFetch<{ data: N8nExecution[] }>(`/executions?workflowId=${workflowId}&limit=${limit}`);
-  return res.data;
-}
+export async function getExecutionDetail(id: string): Promise<N8nExecutionDetail> {
+  return n8nFetch<N8nExecutionDetail>(`/executions/${encodeURIComponent(id)}?includeData=true`);
+}
+
+export async function getWorkflowExecutions(workflowId: string, limit = 50): Promise<N8nExecution[]> {
+  const res = await n8nFetch<{ data: N8nExecution[] }>(`/executions?workflowId=${encodeURIComponent(workflowId)}&limit=${limit}`);
+  return res.data;
+}
```

---

## Notable strengths (no action needed)

These were checked and found correct — flagging them so future reviews don't re-investigate.

- **Webhook auth.** `n8n` (`src/app/api/webhooks/n8n/route.ts:18`), `bunny` (HMAC SHA256 in `src/lib/bunny/client.ts`), and every cron route (`audit-cleanup` etc.) all use `safeCompareSecret` / `timingSafeEqual` correctly. Sentry-watch is the lone exception above.
- **Service-role isolation.** `src/lib/supabase/admin.ts:1` has the `"server-only"` import; no client component imports it. Service-role usage in `(public)/` paths is intentional (rate-limit logging, contact submissions, BotID-gated teacher applications, PayPal flow).
- **Open-redirect protection.** Both `src/app/api/auth/callback/google/route.ts:56` and `src/app/(auth)/actions.ts:203` correctly require `redirect.startsWith("/") && !redirect.startsWith("//")`.
- **Password security.** `passwordIsWeak` enforces 8+ chars and 2-of-3 character classes; per-email rate limits cap login at 10/hr and forgot-password at 5/hr; soft-deleted accounts return a distinct `user_banned` message; no email enumeration in `forgotPassword`.
- **Middleware.** `src/lib/supabase/middleware.ts` calls `getUser()` (verifies against Supabase, not just cookie) and includes a custom shape filter that rejects malformed and expired auth cookies before `@supabase/ssr` parses them.
- **Role gating.** `src/proxy.ts` matcher excludes `/api/`, so each API route owns its own auth check — and they do (verified across the n8n control panel routes, all of which use `requireAdminForApi`).
- **Soft/hard delete safety.** `softDeleteUser` and `hardDeleteUser` (`src/app/admin/users/actions.ts`) require self-protection, name-confirmation typing, and a soft-delete-before-hard sequence.
- **PayPal capture.** `captureAndGrantPackage` (`src/app/(public)/packages/paypal-actions.ts:138`) verifies `payment.student_id === user.id` and is idempotent on `paypal_order_id`.
- **Service worker.** `public/sw.js:46` skips `/api/*` and `/_next/*`, and refuses to cache cross-origin or non-GET requests.
- **CSP transport hardening.** HSTS preload, X-Frame SAMEORIGIN, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, and a tight Permissions-Policy are all set in `vercel.json`. CSP `report-uri` points at Sentry.
- **PII redaction in audit_log.** `redact_pii` trigger (migration `20260428095637`) strips email/phone/parent_email/parent_phone/whatsapp/date_of_birth/avatar_url before writing audit rows.
- **`dangerouslySetInnerHTML` usages** (4 in `src/components/seo/structured-data.tsx`, 1 in `src/app/layout.tsx`): all are static or `JSON.stringify()`'d JSON-LD — no user-controlled content reaches the sink.
- **No SSRF candidates found** — no `fetch(` call in `src/app/api/` or `src/lib/` accepts a URL from request body / search params / headers.
- **No `Access-Control-Allow-Origin: *` / wildcard CORS** anywhere in the codebase.
- **Dependencies** pinned to current majors: `next ^16.2.4`, `react 19.2.5`, `@supabase/ssr ^0.10.0`, `@supabase/supabase-js ^2.105.1`, `@sentry/nextjs ^10.51.0`, `zod ^4.4.2`, `@paypal/react-paypal-js ^9.2.0`, `resend ^6.1.3`, `tus-js-client ^4.3.1`. No obviously-vulnerable pinned majors.

## Out of scope / not reviewed

- **Stripe `checkout/route.ts`** — paired with the deferred webhook stub; same status, same recommendation (501 until SDK lands).
- **Supabase Edge Functions** under `supabase/functions/` (Deno runtime, excluded from `tsconfig.json`).
- **Live RLS policy verification.** Supabase MCP tooling is scoped to a different account; FURQAN lives under `alforqan.egy@gmail.com`. Static SQL review of recent hardening migrations only (`20260428095637_hardening_security_definer_and_rls.sql`, `20260428203550_move_role_check_helpers_to_private_schema.sql`, `20260429052950_split_all_cmd_admin_policies.sql`).
- **`npm audit` / live CVE lookup** — pinned versions inspected manually; no dynamic vulnerability database query.
- **Penetration testing / runtime exploitation** — static review only.
- **Production logs** (Sentry, Vercel) — could not inspect to confirm whether any of the above are being actively exploited.
- **Supabase Auth dashboard settings** — leaked-password protection (HaveIBeenPwned) toggle is a dashboard-only setting per `CLAUDE.md` and was not verified live in this review.
- **Server actions not spot-checked** (cache, class-offerings, community, course-enrollments, course-lessons, course-playback, course-reviews, courses, help, modules, notifications, quizzes, resources, retention-batch, retention-scoring, session-lesson-plan, study-log) — recommend a dedicated pass for ownership-check coverage given the IDOR pattern found in `evaluations.ts`.
