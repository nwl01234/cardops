import autocannon from 'autocannon';

const BASE = process.env.LOAD_BASE ?? 'http://127.0.0.1:8787';

async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      login: process.env.LOAD_LOGIN ?? 'admin',
      password: process.env.LOAD_PASSWORD ?? 'admin123',
    }),
  });
  if (!response.ok) throw new Error(`Login failed: ${response.status}`);
  return response.headers
    .getSetCookie()
    .find((value) => value.startsWith('cardops_session='))
    .split(';')[0];
}

function run(url, cookie) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        connections: Number(process.env.LOAD_CONNECTIONS ?? 10),
        duration: Number(process.env.LOAD_DURATION ?? 5),
        headers: { cookie },
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    autocannon.track(instance, { renderProgressBar: false });
  });
}

const cookie = await login();
for (const path of ['/api/dashboard', '/api/cards?page=1&pageSize=20']) {
  const result = await run(`${BASE}${path}`, cookie);
  console.log(
    JSON.stringify(
      {
        path,
        requests: result.requests.total,
        rps: Math.round(result.requests.average),
        latencyAvgMs: result.latency.average,
        latencyP99Ms: result.latency.p99,
        non2xx: result.non2xx,
        errors: result.errors,
      },
      null,
      2,
    ),
  );
}
