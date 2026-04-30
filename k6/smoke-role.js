/**
 * smoke-role.js — Parameterized smoke test for non-student roles.
 *
 * Drives a k6 VU pool through a configurable list of routes after
 * authenticating each VU once via Supabase. Used by run-smoke-teacher.sh,
 * run-smoke-admin.sh, run-smoke-moderator.sh — each wrapper sets the
 * env vars and invokes this file.
 *
 * Required env:
 *   ROLE                   — one of: teacher, admin, moderator
 *   ROUTES                 — JSON array of paths, e.g. ["/teacher/dashboard","/teacher/students"]
 *   CREDENTIALS_CSV        — path to credentials CSV (relative to k6/)
 *   BASE_URL               — Furqan base URL
 *   SUPABASE_URL           — full Supabase project URL
 *   SUPABASE_ANON_KEY      — anon key for /auth/v1/token
 *
 * Optional env:
 *   VU_COUNT               — defaults to credential count
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

const ROLE = __ENV.ROLE || "teacher";
const ROUTES = JSON.parse(__ENV.ROUTES || "[]");
const CREDENTIALS_CSV = __ENV.CREDENTIALS_CSV || `${ROLE}s-credentials.csv`;
const BASE_URL = __ENV.BASE_URL || "https://www.furqan.today";
const SUPABASE_URL = __ENV.SUPABASE_URL || "https://xyqscjnqfeusgrhmwjts.supabase.co";
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const VU_COUNT = parseInt(__ENV.VU_COUNT || "0", 10);

const authSuccessRate = new Rate("auth_success_rate");
const pageSuccessRate = new Rate(`${ROLE}_page_success_rate`);
const pageLoadTrend = new Trend("page_load_duration");
const authDuration = new Trend("auth_duration");

const credentials = new SharedArray("credentials", function () {
  const data = open(`./${CREDENTIALS_CSV}`);
  const lines = data
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("email,"));
  return lines
    .map((line) => {
      const [email, password] = line.split(",");
      return { email: email?.trim(), password: password?.trim() };
    })
    .filter((c) => c.email && c.password);
});

const RESOLVED_VU_COUNT = VU_COUNT > 0 ? VU_COUNT : credentials.length;

export const options = {
  scenarios: {
    smoke: {
      executor: "per-vu-iterations",
      vus: RESOLVED_VU_COUNT,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<5000"],
    http_req_failed: ["rate<0.15"],
    auth_success_rate: ["rate>0.90"],
    [`${ROLE}_page_success_rate`]: ["rate>0.85"],
  },
};

function authenticate(email, password) {
  const start = Date.now();
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    {
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      redirects: 5,
    },
  );
  authDuration.add(Date.now() - start);
  const ok = res.status === 200 && res.json("access_token");
  authSuccessRate.add(ok ? 1 : 0);
  if (!ok) {
    console.error(`VU ${__VU}: auth failed for ${email} — status=${res.status}`);
    return null;
  }
  const body = res.json();
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    tokenType: body.token_type,
    userId: body.user?.id,
  };
}

export default function () {
  if (ROUTES.length === 0) {
    console.error("ERROR: ROUTES env var is empty or invalid JSON");
    return;
  }
  const cred = credentials[(__VU - 1) % credentials.length];
  if (!cred) {
    console.error(`VU ${__VU}: no credential available`);
    return;
  }

  // Stagger to avoid burst-tripping Supabase rate limit. Match the
  // student smoke's 0.6s spacing.
  sleep((__VU - 1) * 0.6);

  const session = authenticate(cred.email, cred.password);
  if (!session) return;

  const supabaseRef = SUPABASE_URL.replace("https://", "").split(".")[0];
  const cookieName = `sb-${supabaseRef}-auth-token`;
  const cookieValue = JSON.stringify({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    token_type: session.tokenType,
    expires_in: session.expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + session.expiresIn,
    user: { id: session.userId, email: cred.email },
  });
  const headers = {
    Cookie: `${cookieName}=${encodeURIComponent(cookieValue)}`,
    "User-Agent": `k6-smoke-${ROLE}/1.0`,
  };

  // Visit dashboard first (or first listed route), then 3 random others.
  group(`${ROLE}: Dashboard`, function () {
    const res = http.get(`${BASE_URL}${ROUTES[0]}`, { headers, redirects: 5 });
    const ok =
      res.status === 200 &&
      !res.url.includes("/login") &&
      !res.url.includes("/register");
    pageSuccessRate.add(ok ? 1 : 0);
    pageLoadTrend.add(res.timings.duration);
    check(res, {
      "dashboard 200": (r) => r.status === 200,
      "dashboard not login redirect": (r) => !r.url.includes("/login"),
      "dashboard < 5s": (r) => r.timings.duration < 5000,
    });
  });

  sleep(0.2 + Math.random() * 0.3);

  const remainingRoutes = ROUTES.slice(1);
  const shuffled = [...remainingRoutes].sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, Math.min(3, shuffled.length));

  for (const route of sample) {
    const name = route.split("/").pop() || route;
    group(`${ROLE}: ${name}`, function () {
      const res = http.get(`${BASE_URL}${route}`, { headers, redirects: 5 });
      const ok =
        res.status === 200 &&
        !res.url.includes("/login") &&
        !res.url.includes("/register");
      pageSuccessRate.add(ok ? 1 : 0);
      pageLoadTrend.add(res.timings.duration);
      check(res, {
        [`${name} 200`]: (r) => r.status === 200,
        [`${name} not login redirect`]: (r) => !r.url.includes("/login"),
        [`${name} < 5s`]: (r) => r.timings.duration < 5000,
      });
    });
    sleep(0.2 + Math.random() * 0.3);
  }
}

export function handleSummary(data) {
  const authRate = data.metrics.auth_success_rate?.values?.rate;
  const pageRate = data.metrics[`${ROLE}_page_success_rate`]?.values?.rate;
  const p95 = data.metrics.page_load_duration?.values?.["p(95)"];
  console.log("\n============================================================");
  console.log(`  ${ROLE.toUpperCase()} SMOKE SUMMARY`);
  console.log("============================================================");
  console.log(`  VUs:              ${RESOLVED_VU_COUNT}`);
  console.log(`  Credentials:      ${credentials.length}`);
  console.log(`  Routes per VU:    1 dashboard + up to 3 random of ${ROUTES.length - 1}`);
  console.log(`  Base URL:         ${BASE_URL}`);
  console.log(`  Auth Success:     ${authRate !== undefined ? (authRate * 100).toFixed(1) + "%" : "N/A"}`);
  console.log(`  Page Success:     ${pageRate !== undefined ? (pageRate * 100).toFixed(1) + "%" : "N/A"}`);
  console.log(`  P95 Latency:      ${p95 ? Math.round(p95) + "ms" : "N/A"}`);
  console.log("============================================================\n");
  return {
    [`k6-${ROLE}-results.json`]: JSON.stringify(data, null, 2),
  };
}
