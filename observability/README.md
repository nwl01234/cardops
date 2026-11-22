# Observability

Prometheus + Grafana + k6 для CardOps. Docker не требуется.

## Запуск

Prometheus (порт 9090):

```powershell
.data\obs\prometheus\prometheus-3.16.0.windows-amd64\prometheus.exe `
  --config.file=observability\prometheus.yml `
  --storage.tsdb.path=.data\obs\prometheus-data `
  --web.listen-address=127.0.0.1:9090
```

Grafana (порт 3001, логин/пароль `admin/admin`):

```powershell
copy-item observability\grafana\provisioning `
  .data\obs\grafana\grafana-13.3.1\conf\provisioning -Recurse -Force

.data\obs\grafana\grafana-13.3.1\bin\grafana-server.exe `
  --homepath .data\obs\grafana\grafana-13.3.1 `
  --config .data\obs\grafana\grafana-13.3.1\conf\defaults.ini `
  cfg:server.http_port=3001
```

Откройте `http://127.0.0.1:3001`, dashboard **CardOps · SLO / Outbox / Realtime**.

## k6

```powershell
.data\obs\k6\k6-v2.4.0-windows-amd64\k6.exe run observability\k6.js
```

Пороговые значения: 5xx < 1%, p95 < 200 ms, p99 < 500 ms.
API отдаёт `/metrics` (Prometheus format) на core API.

## Что на дашборде

- request rate, p95/p99, 4xx/5xx, availability (SLO);
- outbox pending, DLQ, lag;
- WebSocket connections;
- worker heartbeat age;
- NATS up/down.

`/metrics` в production держите на приватной сети или за allowlist ingress.
