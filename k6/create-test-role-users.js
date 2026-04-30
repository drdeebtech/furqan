/**
 * create-test-role-users.js — Provision test users for any non-student role.
 *
 * Mirrors `create-test-students.js` but parameterized so we don't fork a
 * near-identical script per role. Reads ROLE, COUNT, EMAIL_PREFIX, and
 * OUTPUT from the environment.
 *
 * Usage examples:
 *   ROLE=teacher    COUNT=20 EMAIL_PREFIX=k6-teacher    OUTPUT=teachers-credentials.csv    node k6/create-test-role-users.js
 *   ROLE=admin      COUNT=5  EMAIL_PREFIX=k6-admin      OUTPUT=admins-credentials.csv      node k6/create-test-role-users.js
 *   ROLE=moderator  COUNT=3  EMAIL_PREFIX=k6-moderator  OUTPUT=moderators-credentials.csv  node k6/create-test-role-users.js
 *
 * The wrapper shell scripts at the bottom of run-smoke-all.sh apply
 * sensible defaults so the typical caller doesn't need to set anything.
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local if not
 * set in environment.
 */

const fs = require("fs");
const path = require("path");

const ROLE = process.env.ROLE;
const COUNT = parseInt(process.env.COUNT || "0", 10);
const EMAIL_PREFIX = process.env.EMAIL_PREFIX;
const OUTPUT = process.env.OUTPUT;
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || "furqan.test";
const PASSWORD_BASE = process.env.PASSWORD_BASE || "K6Test!2026";

if (!ROLE || !COUNT || !EMAIL_PREFIX || !OUTPUT) {
  console.error(
    "ERROR: ROLE, COUNT, EMAIL_PREFIX, OUTPUT must all be set.\n" +
      "  Example:\n" +
      "    ROLE=teacher COUNT=20 EMAIL_PREFIX=k6-teacher \\\n" +
      "      OUTPUT=teachers-credentials.csv \\\n" +
      "      node k6/create-test-role-users.js",
  );
  process.exit(1);
}

const ALLOWED_ROLES = ["student", "teacher", "admin", "moderator"];
if (!ALLOWED_ROLES.includes(ROLE)) {
  console.error(`ERROR: invalid ROLE '${ROLE}'; must be one of ${ALLOWED_ROLES.join(", ")}`);
  process.exit(1);
}

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env.local");
const OUTPUT_CSV = path.join(__dirname, OUTPUT);

function loadEnv() {
  const env = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^"|"$/g, "");
      env[key] = val;
    }
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = process.env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.");
  process.exit(1);
}

async function adminApi(method, endpoint, body = null) {
  const url = `${SUPABASE_URL}${endpoint}`;
  const opts = {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: text };
  return { ok: true, status: res.status, data: text ? JSON.parse(text) : null };
}

async function createUser(email, password, fullName) {
  return adminApi("POST", "/auth/v1/admin/users", {
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
}

async function listUserByEmail(email) {
  return adminApi("GET", `/auth/v1/admin/users?email=${encodeURIComponent(email)}`);
}

async function upsertProfile(userId, fullName) {
  // Try insert; on conflict, patch the role.
  const inserted = await adminApi("POST", "/rest/v1/profiles", {
    id: userId,
    full_name: fullName,
    role: ROLE,
    is_active: true,
    lang: "ar",
    timezone: "Africa/Cairo",
  });
  if (inserted.ok) return inserted;
  return adminApi("PATCH", `/rest/v1/profiles?id=eq.${userId}`, {
    role: ROLE,
    is_active: true,
  });
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log(`║  Creating ${COUNT} ${ROLE} accounts for k6 smoke testing`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Supabase:  ${SUPABASE_URL}`);
  console.log(`║  Prefix:    ${EMAIL_PREFIX}`);
  console.log(`║  Domain:    ${EMAIL_DOMAIN}`);
  console.log(`║  Output:    ${OUTPUT}`);
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const results = [];
  let created = 0;
  let existing = 0;
  let failed = 0;

  for (let i = 1; i <= COUNT; i++) {
    const padded = String(i).padStart(3, "0");
    const email = `${EMAIL_PREFIX}${padded}@${EMAIL_DOMAIN}`;
    const password = `${PASSWORD_BASE}${padded}`;
    const fullName = `K6 Test ${ROLE.charAt(0).toUpperCase()}${ROLE.slice(1)} ${padded}`;

    let userId = null;
    const existingRes = await listUserByEmail(email);
    if (existingRes.ok && existingRes.data?.users?.length > 0) {
      userId = existingRes.data.users[0].id;
      existing++;
    } else {
      const createRes = await createUser(email, password, fullName);
      if (createRes.ok && createRes.data?.id) {
        userId = createRes.data.id;
        created++;
      } else {
        console.error(`  [${padded}] failed: ${createRes.error?.slice(0, 100)}`);
        failed++;
        continue;
      }
    }

    if (userId) {
      const upsertRes = await upsertProfile(userId, fullName);
      if (!upsertRes.ok) {
        console.error(`  [${padded}] profile upsert failed: ${upsertRes.error?.slice(0, 100)}`);
      }
      results.push({ email, password });
    }

    if (i % 25 === 0) {
      process.stdout.write(`  progress: ${i}/${COUNT}\r`);
    }
  }

  console.log(`\n  created=${created} existing=${existing} failed=${failed}`);

  const csv = ["email,password"]
    .concat(results.map((r) => `${r.email},${r.password}`))
    .join("\n");
  fs.writeFileSync(OUTPUT_CSV, csv);
  console.log(`  wrote ${results.length} rows to ${OUTPUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
