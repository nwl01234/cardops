import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8787';

export const options = {
  scenarios: {
    read_path: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '10s', target: 25 },
        { duration: '30s', target: 25 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const response = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ login: 'admin', password: 'admin123' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(response, { 'login 200': (r) => r.status === 200 });
  const session = response.cookies.cardops_session?.[0]?.value;
  if (!session) throw new Error('No session cookie returned by login');
  return { cookie: `cardops_session=${session}` };
}

export default function (data) {
  const headers = { Cookie: data.cookie };
  const dashboard = http.get(`${BASE}/api/dashboard`, { headers });
  check(dashboard, { 'dashboard 200': (r) => r.status === 200 });

  const cards = http.get(`${BASE}/api/cards?page=1&pageSize=20`, { headers });
  check(cards, {
    'cards 200': (r) => r.status === 200,
    'cards page': (r) => r.json('data.page') === 1,
  });

  sleep(0.2);
}
