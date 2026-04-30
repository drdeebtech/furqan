import http from 'k6/http';

const url = 'https://xyqscjnqfeusgrhmwjts.supabase.co/auth/v1/token?grant_type=password';
const apikey = __ENV.SUPABASE_ANON_KEY;

export const options = { vus: 1, iterations: 1 };

export default function () {
  const payload = JSON.stringify({
    email: 'k6-student001@furqan.test',
    password: 'K6Test!2026001',
  });
  const res = http.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      apikey,
    },
  });
  console.log('status=' + res.status);
  console.log('body=' + res.body);
}
