/**
 * k6 smoke test — public read paths against production.
 *
 * Goal: baseline p50/p95/p99 latency and surface any unhandled errors
 * to Sentry. Pure read-only GET traffic; no forms, no auth, no writes.
 *
 * Load profile is intentionally gentle (~1.5 RPS sustained) to stay
 * under Vercel Hobby's ~100 functions/min ceiling so we measure app
 * behavior, not Vercel's throttling.
 *
 * Usage:
 *   k6 run tests/load/smoke.js
 *
 * Override base URL for staging or preview:
 *   k6 run -e BASE_URL=https://furqan-preview.vercel.app tests/load/smoke.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "https://furqan.today";

// Per-route latency trends so the summary breaks out timing by page,
// not just an overall average that hides which path is slow.
const trends = {
  homepage: new Trend("route_homepage_ms", true),
  about: new Trend("route_about_ms", true),
  packages: new Trend("route_packages_ms", true),
  blog: new Trend("route_blog_ms", true),
  teachers: new Trend("route_teachers_ms", true),
};

const ROUTES = [
  { name: "homepage", path: "/" },
  { name: "about", path: "/about" },
  { name: "packages", path: "/packages" },     // hits Supabase, no cache
  { name: "blog", path: "/blog" },             // 50+ row select
  { name: "teachers", path: "/teachers-page" }, // RLS-gated query
];

export const options = {
  vus: 5,
  duration: "60s",

  // Identifying UA so any future log-grep can filter synthetic traffic
  // out of real user analytics easily.
  userAgent: "furqan-k6-smoke/1.0",

  thresholds: {
    // Generous initial bounds — tighten once we have a baseline.
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1500"],
  },
};

export default function smokeIteration() {
  // Each VU walks the route list once per iteration with a 1-second
  // pause between requests — mimics a real visitor browsing pages,
  // not a flood.
  for (const route of ROUTES) {
    const res = http.get(`${BASE}${route.path}`, {
      tags: { route: route.name },
    });

    trends[route.name].add(res.timings.duration);

    check(res, {
      [`${route.name} status is 200`]: (r) => r.status === 200,
      [`${route.name} body not empty`]: (r) => r.body && r.body.length > 100,
    });

    sleep(1);
  }
}
