/**
 * create-test-students.js — Create 500 student accounts for k6 load testing
 *
 * Uses the Supabase Admin API (service role key) to:
 *   1. Create 500 users in auth.users with auto-confirmed emails
 *   2. Ensure each user has role='student' in the profiles table
 *   3. Output a credentials CSV for k6 to consume
 *
 * Usage:
 *   node k6/create-test-students.js
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local
 * if not set in environment.
 *
 * Output:
 *   k6/students-credentials.csv  — email,password pairs for k6
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Config ──────────────────────────────────────────────────────────────────

const STUDENT_COUNT = 500;
const EMAIL_PREFIX = "k6-student";
const EMAIL_DOMAIN = "furqan.test"; // Fake domain — no real emails needed
const PASSWORD_BASE = "K6Test!2026"; // Meets 8+ chars, upper+lower+digit
const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env.local");
const OUTPUT_CSV = path.join(__dirname, "students-credentials.csv");

// ── Load env ────────────────────────────────────────────────────────────────

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
  console.error("Set them in environment or .env.local");
  process.exit(1);
}

// ── Supabase Admin API helpers ──────────────────────────────────────────────

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

  if (!res.ok) {
    return { ok: false, status: res.status, error: text };
  }
  return { ok: true, status: res.status, data: text ? JSON.parse(text) : null };
}

/**
 * Create a user via the Supabase Admin API.
 * This bypasses email verification and creates the user directly.
 */
async function createUser(email, password, fullName) {
  return adminApi("POST", "/auth/v1/admin/users", {
    email,
    password,
    email_confirm: true, // Auto-confirm — no email verification needed
    user_metadata: {
      full_name: fullName,
    },
  });
}

/**
 * Upsert the profile row to ensure role='student' and is_active=true.
 * The handle_new_user trigger should create the profile, but we force
 * the role to 'student' and set is_active in case the default differs.
 */
async function ensureStudentProfile(userId, fullName) {
  return adminApi("POST", "/rest/v1/profiles", {
    id: userId,
    full_name: fullName,
    role: "student",
    is_active: true,
    lang: "ar",
    timezone: "Africa/Cairo",
  });
}

/**
 * Update profile if INSERT fails (already exists from trigger).
 */
async function updateStudentProfile(userId, fullName) {
  return adminApi("PATCH", `/rest/v1/profiles?id=eq.${userId}`, {
    role: "student",
    is_active: true,
  });
}

/**
 * Check if a user already exists by email.
 */
async function listUserByEmail(email) {
  return adminApi("GET", `/auth/v1/admin/users?email=${encodeURIComponent(email)}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Creating 500 Student Accounts for k6 Smoke Testing    ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Supabase:  ${SUPABASE_URL}`);
  console.log(`║  Prefix:    ${EMAIL_PREFIX}`);
  console.log(`║  Domain:    ${EMAIL_DOMAIN}`);
  console.log(`║  Count:     ${STUDENT_COUNT}`);
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const results = [];
  let created = 0;
  let existing = 0;
  let failed = 0;

  for (let i = 1; i <= STUDENT_COUNT; i++) {
    const padded = String(i).padStart(3, "0");
    const email = `${EMAIL_PREFIX}${padded}@${EMAIL_DOMAIN}`;
    const password = `${PASSWORD_BASE}${padded}`; // Unique per student
    const fullName = `K6 Test Student ${padded}`;

    process.stdout.write(`[${i}/${STUDENT_COUNT}] ${email} ... `);

    try {
      // Step 1: Create user in auth.users
      const createRes = await createUser(email, password, fullName);

      if (createRes.ok) {
        const userId = createRes.data.id;
        process.stdout.write("user created, ");

        // Step 2: Ensure profile has role='student'
        const profileRes = await ensureStudentProfile(userId, fullName);
        if (profileRes.ok) {
          process.stdout.write("profile created ✓\n");
        } else {
          // Profile might already exist from trigger — try update instead
          const updateRes = await updateStudentProfile(userId, fullName);
          if (updateRes.ok) {
            process.stdout.write("profile updated ✓\n");
          } else {
            process.stdout.write(
              `profile warning: ${JSON.stringify(profileRes.error).substring(0, 80)}\n`
            );
          }
        }

        results.push({ email, password, userId, status: "created" });
        created++;
      } else {
        // Check if it's "already exists" error
        const errMsg = typeof createRes.error === "string" ? createRes.error : JSON.stringify(createRes.error);

        if (createRes.status === 422 || errMsg.includes("already registered") || errMsg.includes("already been registered")) {
          process.stdout.write("already exists, ensuring profile ... ");

          // User exists — find their ID and ensure profile role
          const listRes = await listUserByEmail(email);
          if (listRes.ok && listRes.data?.users?.length > 0) {
            const userId = listRes.data.users[0].id;
            const updateRes = await updateStudentProfile(userId, fullName);
            if (updateRes.ok) {
              process.stdout.write("profile updated ✓\n");
            } else {
              process.stdout.write("profile ok (trigger)\n");
            }
            results.push({ email, password, userId, status: "existing" });
          } else {
            process.stdout.write("found but can't fetch ID\n");
            results.push({ email, password, userId: null, status: "existing-no-id" });
          }
          existing++;
        } else {
          process.stdout.write(`FAILED: ${errMsg.substring(0, 100)}\n`);
          results.push({ email, password, userId: null, status: "failed", error: errMsg });
          failed++;
        }
      }

      // Small delay to avoid hammering the API
      if (i % 10 === 0) {
        process.stdout.write(`  --- progress: ${i}/${STUDENT_COUNT} (created=${created}, existing=${existing}, failed=${failed}) ---\n`);
        await new Promise((r) => setTimeout(r, 500)); // 500ms pause every 10
      }
    } catch (err) {
      process.stdout.write(`EXCEPTION: ${err.message}\n`);
      results.push({ email, password, userId: null, status: "error", error: err.message });
      failed++;
    }
  }

  // ── Write CSV ───────────────────────────────────────────────────────────

  const csvLines = ["email,password"];
  for (const r of results) {
    if (r.status !== "failed" && r.status !== "error") {
      csvLines.push(`${r.email},${r.password}`);
    }
  }
  fs.writeFileSync(OUTPUT_CSV, csvLines.join("\n") + "\n");

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log("\n" + "═".repeat(60));
  console.log("  CREATION SUMMARY");
  console.log("═".repeat(60));
  console.log(`  Total:     ${STUDENT_COUNT}`);
  console.log(`  Created:   ${created}`);
  console.log(`  Existing:  ${existing}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  CSV file:  ${OUTPUT_CSV}`);
  console.log(`  CSV rows:  ${csvLines.length - 1}`);
  console.log("═".repeat(60));

  if (failed > 0) {
    console.log("\n  Failed accounts:");
    for (const r of results.filter((r) => r.status === "failed" || r.status === "error")) {
      console.log(`    ${r.email}: ${r.error?.substring(0, 100) || "unknown"}`);
    }
  }

  console.log("\n  Next step: Run the smoke test with:");
  console.log("    ./k6/run-smoke-student.sh");
  console.log("  (The k6 script will be updated to use the CSV file)");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});