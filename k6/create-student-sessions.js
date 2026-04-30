const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env.local");
const CREDENTIALS_CSV = path.join(__dirname, "students-credentials.csv");
const OUTPUT_JSON = path.join(__dirname, "student-sessions.json");
const BASE_URL = process.env.BASE_URL || "https://www.furqan.today";
const AUTH_DELAY_MS = parseInt(process.env.AUTH_DELAY_MS || "1500", 10);

function loadEnv() {
  const env = {};
  if (!fs.existsSync(ENV_FILE)) return env;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"|"$/g, "");
    env[key] = val;
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = process.env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  process.exit(1);
}

if (!fs.existsSync(CREDENTIALS_CSV)) {
  console.error(`Credentials CSV not found: ${CREDENTIALS_CSV}`);
  process.exit(1);
}

function loadCredentials() {
  return fs
    .readFileSync(CREDENTIALS_CSV, "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("email,"))
    .map((line) => {
      const [email, password] = line.split(",");
      return { email: email.trim(), password: password.trim() };
    });
}

function buildCookie(email, userId, session) {
  const supabaseRef = SUPABASE_URL.replace("https://", "").split(".")[0];
  const authTokenCookieName = `sb-${supabaseRef}-auth-token`;
  const cookieValue = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    user: { id: userId, email },
  });
  return {
    name: authTokenCookieName,
    value: encodeURIComponent(cookieValue),
    header: `${authTokenCookieName}=${encodeURIComponent(cookieValue)}`,
  };
}

async function authenticate(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  return { ok: res.ok, status: res.status, body };
}

async function main() {
  const credentials = loadCredentials();
  const sessions = [];
  let success = 0;
  let failed = 0;

  console.log("Preparing pre-authenticated student sessions");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Credentials: ${credentials.length}`);
  console.log(`Delay: ${AUTH_DELAY_MS}ms between auth requests`);
  console.log("");

  for (let i = 0; i < credentials.length; i++) {
    const { email, password } = credentials[i];
    process.stdout.write(`[${i + 1}/${credentials.length}] ${email} ... `);

    const res = await authenticate(email, password);
    if (!res.ok || !res.body?.access_token || !res.body?.user?.id) {
      failed += 1;
      process.stdout.write(`FAILED status=${res.status} body=${JSON.stringify(res.body).slice(0, 120)}\n`);
    } else {
      success += 1;
      const cookie = buildCookie(email, res.body.user.id, res.body);
      sessions.push({
        email,
        userId: res.body.user.id,
        accessToken: res.body.access_token,
        refreshToken: res.body.refresh_token,
        tokenType: res.body.token_type,
        expiresAt: res.body.expires_at,
        cookieName: cookie.name,
        cookieValue: cookie.value,
        cookieHeader: cookie.header,
      });
      process.stdout.write("OK\n");
    }

    if (i < credentials.length - 1) {
      await new Promise((r) => setTimeout(r, AUTH_DELAY_MS));
    }
  }

  fs.writeFileSync(
    OUTPUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        supabaseUrl: SUPABASE_URL,
        authDelayMs: AUTH_DELAY_MS,
        success,
        failed,
        sessions,
      },
      null,
      2,
    ) + "\n",
  );

  console.log("\nSummary");
  console.log(`  Success: ${success}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Output:  ${OUTPUT_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
