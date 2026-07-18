// One-shot: ensure the @furqan.test test accounts exist with correct passwords/roles
// Usage: node scripts/fix-test-accounts.mjs
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local manually
const envFile = readFileSync('.env.local', 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Warn clearly about which project is targeted so accidental prod runs are obvious.
console.warn(`⚠️  Targeting Supabase project: ${supabaseUrl}`);
console.warn('   This script only touches @furqan.test accounts. Pass --yes to skip this prompt.');
if (!process.argv.includes('--yes')) {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve, reject) =>
    rl.question('Continue? [y/N] ', ans => {
      rl.close();
      if (ans.toLowerCase() !== 'y') { console.error('Aborted.'); process.exit(0); }
      resolve();
    })
  );
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const STUDENT_EMAIL = 'test-student@furqan.test';
const TEACHER_EMAIL = 'test-teacher@furqan.test';
const STUDENT_PASS = 'FurqTest2026!';
const TEACHER_PASS = 'FurqTeach2026!';

async function main() {
  // 1. Unban + reset student password
  const { data: { users }, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) { console.error('listUsers failed:', listErr.message); process.exit(1); }

  const student = users.find(u => u.email === STUDENT_EMAIL);
  const teacher = users.find(u => u.email === TEACHER_EMAIL);

  if (student) {
    const { error } = await admin.auth.admin.updateUserById(student.id, {
      ban_duration: 'none',
      password: STUDENT_PASS,
    });
    if (error) console.error('Student update failed:', error.message);
    else console.log('✓ Student unbanned + password reset');
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: STUDENT_EMAIL, password: STUDENT_PASS,
      email_confirm: true,
      user_metadata: { role: 'student' },
    });
    if (error) console.error('Student create failed:', error.message);
    else {
      const { error: profileErr } = await admin.from('profiles').insert({ id: data.user.id, role: 'student', full_name: 'Test Student', is_active: true });
      if (profileErr) { console.error('Student profile insert failed:', profileErr.message); process.exit(1); }
      else console.log('✓ Student account created');
    }
  }

  if (teacher) {
    const { error } = await admin.auth.admin.updateUserById(teacher.id, {
      ban_duration: 'none',
      password: TEACHER_PASS,
    });
    if (error) console.error('Teacher update failed:', error.message);
    else console.log('✓ Teacher password reset');
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: TEACHER_EMAIL, password: TEACHER_PASS,
      email_confirm: true,
      user_metadata: { role: 'teacher' },
    });
    if (error) console.error('Teacher create failed:', error.message);
    else {
      const { error: profileErr } = await admin.from('profiles').insert({ id: data.user.id, role: 'teacher', full_name: 'Test Teacher', is_active: true });
      if (profileErr) { console.error('Teacher profile insert failed:', profileErr.message); process.exit(1); }
      else console.log('✓ Teacher account created');
    }
  }

  console.log('\nCredentials set:');
  console.log(`  student: ${STUDENT_EMAIL} / ${STUDENT_PASS}`);
  console.log(`  teacher: ${TEACHER_EMAIL} / ${TEACHER_PASS}`);
}

main().catch(e => { console.error(e); process.exit(1); });
