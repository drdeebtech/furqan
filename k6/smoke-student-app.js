import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL || "https://www.furqan.today";

const sessionData = new SharedArray("student_sessions", function () {
  const raw = open("./student-sessions.json");
  const parsed = JSON.parse(raw);
  return parsed.sessions || [];
});

const VU_COUNT = Math.min(sessionData.length, parseInt(__ENV.VU_COUNT || String(sessionData.length), 10));

const pageLoadTrend = new Trend("page_load_duration", true);
const studentPageSuccessRate = new Rate("student_page_success_rate");
const sessionAvailableRate = new Rate("session_available_rate");

export const options = {
  scenarios: {
    app_smoke: {
      executor: "per-vu-iterations",
      vus: VU_COUNT,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<5000"],
    http_req_failed: ["rate<0.10"],
    session_available_rate: ["rate>0.99"],
    student_page_success_rate: ["rate>0.95"],
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

function baseHeadersFor(session) {
  return {
    Cookie: session.cookieHeader,
    "User-Agent": "k6-app-smoke/1.0",
  };
}

function visitPage(path, headers, metricName) {
  const res = http.get(`${BASE_URL}${path}`, { headers, redirects: 5 });
  const ok = res.status === 200 && !res.url.includes("/login") && !res.url.includes("/register");
  studentPageSuccessRate.add(ok ? 1 : 0);
  pageLoadTrend.add(res.timings.duration);
  check(res, {
    [`${metricName} 200`]: (r) => r.status === 200,
    [`${metricName} not login redirect`]: (r) => !r.url.includes("/login"),
    [`${metricName} < 5s`]: (r) => r.timings.duration < 5000,
  });
  return res;
}

export default function () {
  const session = sessionData[(__VU - 1) % sessionData.length];
  const hasSession = !!session?.cookieHeader;
  sessionAvailableRate.add(hasSession ? 1 : 0);
  if (!hasSession) {
    console.error(`VU ${__VU}: No pre-auth session found`);
    return;
  }

  const headers = baseHeadersFor(session);

  group("Student: Dashboard", function () {
    visitPage("/student/dashboard", headers, "dashboard");
  });

  sleep(0.2 + Math.random() * 0.3);

  const selectedPages = [...STUDENT_PAGES].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const page of selectedPages) {
    const pageName = page.split("/").pop() || page;
    group(`Student: ${pageName}`, function () {
      visitPage(page, headers, pageName);
    });
    sleep(0.2 + Math.random() * 0.3);
  }

  group("Public: Home", function () {
    const res = http.get(`${BASE_URL}/`, { redirects: 5 });
    check(res, { "home 200": (r) => r.status === 200 });
  });
}

export function handleSummary(data) {
  const pageRate = data.metrics.student_page_success_rate?.values?.rate;
  const p95 = data.metrics.page_load_duration?.values?.["p(95)"];
  const sessionRate = data.metrics.session_available_rate?.values?.rate;
  console.log("\n============================================================");
  console.log("  APP-ONLY SMOKE TEST SUMMARY — Pre-authenticated Students");
  console.log("============================================================");
  console.log(`  VUs:              ${VU_COUNT}`);
  console.log(`  Sessions loaded:  ${sessionData.length}`);
  console.log(`  Base URL:         ${BASE_URL}`);
  console.log(`  Session Ready:    ${sessionRate !== undefined ? (sessionRate * 100).toFixed(1) + "%" : "N/A"}`);
  console.log(`  Page Success:     ${pageRate !== undefined ? (pageRate * 100).toFixed(1) + "%" : "N/A"}`);
  console.log(`  P95 Latency:      ${p95 ? Math.round(p95) + "ms" : "N/A"}`);
  console.log(`  Timestamp:        ${new Date().toISOString()}`);
  console.log("============================================================\n");
  return {
    "k6-app-results.json": JSON.stringify(data, null, 2),
  };
}
