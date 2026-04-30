/**
 * k6 Smoke Test — Student Virtual Users (CSV-driven)
 * ===================================================
 * Simulates up to 500 VUs each logging in once as a different student,
 * then browsing a short student journey.
 *
 * This is a true smoke test: one session per VU, not repeated re-logins.
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL || "https://www.furqan.today";
const SUPABASE_URL = __ENV.SUPABASE_URL || "https://xyqscjnqfeusgrhmwjts.supabase.co";
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error("ERROR: SUPABASE_ANON_KEY is required.");
}

const students = new SharedArray("students", function () {
  const data = open("./students-credentials.csv");
  const lines = data.split("\n").filter((l) => l.trim() && !l.startsWith("email,"));
  return lines
    .map((line) => {
      const [email, password] = line.split(",");
      return { email: email?.trim(), password: password?.trim() };
    })
    .filter((s) => s.email && s.password);
});

const authSuccessRate = new Rate("auth_success_rate");
const pageLoadTrend = new Trend("page_load_duration", true);
const studentPageSuccessRate = new Rate("student_page_success_rate");
const authDuration = new Trend("auth_duration_ms", true);

const VU_COUNT = Math.min(students.length, parseInt(__ENV.VU_COUNT || String(students.length), 10));

export const options = {
  scenarios: {
    smoke: {
      executor: "per-vu-iterations",
      vus: VU_COUNT,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<5000"],
    http_req_failed: ["rate<0.15"],
    auth_success_rate: ["rate>0.90"],
    student_page_success_rate: ["rate>0.85"],
  },
  noConnectionReuse: false,
};

const STUDENT_PAGES = [
  "/student/dashboard",
  "/student/courses",
  "/student/sessions",
  "/student/bookings",
  "/student/calendar",
  "/student/teachers",
  "/student/homework",
  "/student/progress",
  "/student/notes",
  "/student/packages",
  "/student/settings",
  "/student/resources",
  "/student/quizzes",
  "/student/messages",
  "/student/time-tracker",
];

function authenticate(email, password) {
  const authStart = Date.now();
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    {
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      redirects: 5,
    }
  );
  authDuration.add(Date.now() - authStart);

  const success = res.status === 200 && res.json("access_token");
  authSuccessRate.add(success ? 1 : 0);

  if (!success) {
    console.error(`VU ${__VU}: Auth failed for ${email} — status=${res.status} body=${String(res.body).slice(0, 200)}`);
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
  const student = students[(__VU - 1) % students.length];
  if (!student) {
    console.error(`VU ${__VU}: No student credential found`);
    return;
  }

  // Stagger auth attempts to avoid Supabase rate limiting on a 100-user burst.
  sleep((__VU - 1) * 0.6);

  const session = authenticate(student.email, student.password);
  if (!session) return;

  const supabaseRef = SUPABASE_URL.replace("https://", "").split(".")[0];
  const authTokenCookieName = `sb-${supabaseRef}-auth-token`;
  const cookieValue = JSON.stringify({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    token_type: session.tokenType,
    expires_in: session.expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + session.expiresIn,
    user: { id: session.userId, email: student.email },
  });
  const baseHeaders = {
    Cookie: `${authTokenCookieName}=${encodeURIComponent(cookieValue)}`,
    "User-Agent": "k6-smoke-test/1.0",
  };

  group("Student: Dashboard", function () {
    const res = http.get(`${BASE_URL}/student/dashboard`, { headers: baseHeaders, redirects: 5 });
    const ok = res.status === 200 && !res.url.includes("/login") && !res.url.includes("/register");
    studentPageSuccessRate.add(ok ? 1 : 0);
    pageLoadTrend.add(res.timings.duration);
    check(res, {
      "dashboard 200": (r) => r.status === 200,
      "dashboard not login redirect": (r) => !r.url.includes("/login"),
      "dashboard < 5s": (r) => r.timings.duration < 5000,
    });
  });

  sleep(0.2 + Math.random() * 0.3);

  const shuffled = [...STUDENT_PAGES].sort(() => Math.random() - 0.5);
  const selectedPages = shuffled.slice(0, 3);

  for (const page of selectedPages) {
    const pageName = page.split("/").pop() || page;
    group(`Student: ${pageName}`, function () {
      const res = http.get(`${BASE_URL}${page}`, { headers: baseHeaders, redirects: 5 });
      const ok = res.status === 200 && !res.url.includes("/login") && !res.url.includes("/register");
      studentPageSuccessRate.add(ok ? 1 : 0);
      pageLoadTrend.add(res.timings.duration);
      check(res, {
        [`${pageName} 200`]: (r) => r.status === 200,
        [`${pageName} not login redirect`]: (r) => !r.url.includes("/login"),
        [`${pageName} < 5s`]: (r) => r.timings.duration < 5000,
      });
    });
    sleep(0.2 + Math.random() * 0.3);
  }

  group("Public: Home", function () {
    const res = http.get(`${BASE_URL}/`, { redirects: 5 });
    check(res, { "home 200": (r) => r.status === 200 });
  });
}

export function handleSummary(data) {
  const authRate = data.metrics.auth_success_rate?.values?.rate;
  const pageRate = data.metrics.student_page_success_rate?.values?.rate;
  const p95 = data.metrics.page_load_duration?.values?.["p(95)"];
  console.log("\n============================================================");
  console.log("  SMOKE TEST SUMMARY — Student VUs");
  console.log("============================================================");
  console.log(`  VUs:              ${VU_COUNT}`);
  console.log(`  Credentials:      ${students.length} students loaded`);
  console.log(`  Base URL:         ${BASE_URL}`);
  console.log(`  Auth Success:     ${authRate !== undefined ? (authRate * 100).toFixed(1) + "%" : "N/A"}`);
  console.log(`  Page Success:     ${pageRate !== undefined ? (pageRate * 100).toFixed(1) + "%" : "N/A"}`);
  console.log(`  P95 Latency:      ${p95 ? Math.round(p95) + "ms" : "N/A"}`);
  console.log(`  Timestamp:        ${new Date().toISOString()}`);
  console.log("============================================================\n");
  return {
    "k6-results.json": JSON.stringify(data, null, 2),
  };
}
