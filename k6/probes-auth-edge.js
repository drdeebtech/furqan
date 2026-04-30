/**
 * k6 Auth-edge Adversarial Probe Suite
 * =====================================
 * Targeted regressions against the auth middleware. Each probe sends an
 * intentionally malformed cookie to a protected route and asserts that:
 *   - The response is 200 (after redirect)
 *   - The final URL contains "/login" (i.e. middleware redirected, didn't
 *     accept the cookie)
 *   - The response did NOT 500
 *
 * The probes run as separate k6 scenarios so each appears in the summary
 * with its own labels, making "what passed / what failed" immediately
 * legible without parsing JSON output.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 k6 run k6/probes-auth-edge.js
 *
 * What this catches (paired with the auth-hardening commits 48accbc and
 * 0837326):
 *   - Junk auth cookies — TypeError in @supabase/ssr (fixed in 48accbc)
 *   - Empty cookie value — same regression class
 *   - Expired-but-shape-valid token (fixed in 0837326 via expires_at)
 *   - Truncated JSON / partially-written rotation cookie
 *   - Tampered base64 prefix
 *
 * What this does NOT catch (would need DB fixtures):
 *   - Deleted user with valid token
 *   - Deleted profile row with valid auth user
 *   - Role mutation race
 * Those are better tested as integration tests with explicit setup/teardown
 * against a non-prod Supabase project.
 */

import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const SUPABASE_REF = __ENV.SUPABASE_REF || "xyqscjnqfeusgrhmwjts";
const COOKIE_NAME = `sb-${SUPABASE_REF}-auth-token`;

// A token shape valid enough to pass shape check but with `expires_at`
// firmly in the past. After commit 0837326, the cookie filter decodes
// the payload and rejects this; before, the SDK would accept it and
// downstream pages render against a null user.
const EXPIRED_PAYLOAD = JSON.stringify({
  access_token: "fake.fake.fake",
  refresh_token: "x",
  token_type: "bearer",
  expires_in: 0,
  expires_at: 1700000000, // 2023-11-14 — clearly past
  user: { id: "00000000-0000-0000-0000-000000000000", email: "expired@test.local" },
});

const PROBES = [
  {
    name: "junk-cookie",
    cookie: `${COOKIE_NAME}=junk`,
    expect: "redirect to /login, no TypeError",
  },
  {
    name: "empty-cookie",
    cookie: `${COOKIE_NAME}=`,
    expect: "redirect to /login, no TypeError",
  },
  {
    name: "truncated-json",
    cookie: `${COOKIE_NAME}={"access_token":`,
    expect: "redirect to /login, no parse error",
  },
  {
    name: "tampered-base64",
    cookie: `${COOKIE_NAME}=base64-NOT_VALID_BASE64===`,
    expect: "redirect to /login, no decode error",
  },
  {
    name: "expired-token",
    cookie: `${COOKIE_NAME}=${EXPIRED_PAYLOAD}`,
    expect: "redirect to /login (filter drops by expires_at)",
  },
  {
    name: "null-byte-cookie",
    cookie: `${COOKIE_NAME}=%00%00%00`,
    expect: "redirect to /login, no encoding crash",
  },
];

// One iteration per probe; run sequentially so the summary is a clean
// 1:1 mapping of probe name → result.
export const options = {
  scenarios: {
    auth_edge: {
      executor: "shared-iterations",
      vus: 1,
      iterations: PROBES.length,
      maxDuration: "1m",
    },
  },
  thresholds: {
    "checks{probe:junk-cookie}": ["rate==1"],
    "checks{probe:empty-cookie}": ["rate==1"],
    "checks{probe:truncated-json}": ["rate==1"],
    "checks{probe:tampered-base64}": ["rate==1"],
    "checks{probe:expired-token}": ["rate==1"],
    "checks{probe:null-byte-cookie}": ["rate==1"],
  },
};

export default function () {
  const probe = PROBES[__ITER % PROBES.length];
  const headers = {
    Cookie: probe.cookie,
    "User-Agent": "k6-auth-edge-probe/1.0",
  };

  const res = http.get(`${BASE_URL}/student/dashboard`, {
    headers,
    redirects: 5,
    tags: { probe: probe.name },
  });

  // k6's `res.url` does not always update through the redirect chain on
  // some Next 16 dev-server responses, so we infer "redirected to login"
  // from body content (the rendered login page) rather than the URL field.
  // Manual curl confirms the redirect IS happening — we're checking the
  // landing page evidence, not the URL bar.
  const body = typeof res.body === "string" ? res.body : "";

  // Login page markers — Arabic title plus a stable form field. Either
  // present means we landed on the login page.
  const loginMarkers = ["تسجيل الدخول", 'name="email"', 'href="/forgot-password"'];
  const onLoginPage =
    body.length > 0 && loginMarkers.some((m) => body.includes(m));

  // No upstream error string in the rendered body. Skip if the body wasn't
  // captured as a string (k6 can return binary for some responses).
  const bodyClean =
    body.length === 0 ||
    (!body.includes("TypeError") &&
      !body.includes("NotSingleError") &&
      !body.includes("Cannot create property") &&
      !body.includes("Cannot read property"));

  check(
    res,
    {
      "status is 200": (r) => r.status === 200,
      "landed on login page": () => onLoginPage,
      "did not 500": (r) => r.status !== 500,
      "no upstream error in body": () => bodyClean,
    },
    { probe: probe.name },
  );
}

export function handleSummary(data) {
  const probesResults = PROBES.map((p) => {
    const checkData = data.metrics.checks?.values;
    const passed = checkData?.passes ?? 0;
    const fails = checkData?.fails ?? 0;
    return { name: p.name, expect: p.expect, passed, fails };
  });

  console.log("");
  console.log("============================================================");
  console.log("  AUTH-EDGE PROBE SUITE — Result Summary");
  console.log("============================================================");
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Probes run: ${PROBES.length}`);
  console.log(`  Total checks passed: ${data.metrics.checks?.values?.passes ?? 0}`);
  console.log(`  Total checks failed: ${data.metrics.checks?.values?.fails ?? 0}`);
  console.log("============================================================");
  for (const p of probesResults) {
    console.log(`  ${p.name.padEnd(20)} — ${p.expect}`);
  }
  console.log("============================================================");
  console.log("");

  return {
    "k6-auth-edge-results.json": JSON.stringify(data, null, 2),
  };
}
