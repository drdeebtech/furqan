import http from 'k6/http';

const url = 'https://xyqscjnqfeusgrhmwjts.supabase.co/auth/v1/token?grant_type=password';
const apikey = __ENV.SUPABASE_ANON_KEY;

export const options = { vus: 1, iterations: 1 };

export default function () {
  const payload = JSON.stringify({
    email: 'k6-student001@furqan.test',
    // set K6_TEST_PASSWORD env var before running
    password: __ENV.K6_TEST_PASSWORD,
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
