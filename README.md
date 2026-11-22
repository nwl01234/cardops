# CardOps

Внутренняя платформа учёта карт, склада и операций: React-кабинет, сервисный
backend на TypeScript, PostgreSQL, Redis, NATS, realtime и OCR.

Это готовый **demo-продукт с вымышленными данными**: полный сквозной сценарий
«создали карту → выдали → вернули → списали → увидели в аудите», плюс
инфраструктурные вещи, которые обычно остаются «на потом»: refresh rotation,
отзыв сессий, Redis rate limit, отдельный outbox-worker, NATS, distributed
WebSocket fanout, OCR, админка пользователей, tracing, alerts, backup и load test.

## 1. What this is

| Сервис             |  Порт | Ответственность                                                 |
| ------------------ | ----: | --------------------------------------------------------------- |
| **web**            |  5173 | React SPA, кабинеты admin/manager/warehouse                     |
| **core API**       |  8787 | auth/session, users, cards, warehouse, audit, dashboard, system |
| **notifications**  |  8790 | WebSocket gateway + Redis fanout + NATS consumer                |
| **scan**           |  8791 | Tesseract.js OCR: фото → текст → SKU                            |
| **documents**      |  8792 | PDF-акт по карте + запись в MinIO/S3                            |
| **outbox worker**  |     — | `outbox_events → JetStream` отдельным процессом                 |
| **PostgreSQL**     | 55432 | users, cards, operations, refresh tokens, idempotency, outbox   |
| **Redis**          |  6379 | rate limit, sessions, WS fanout, traces, worker heartbeat       |
| **NATS JetStream** |  4222 | durable stream `CARDOPS`, DLQ, replay                           |
| **S3 / MinIO**     |  9000 | артефакты документов, presigned-ready bucket                    |

Это **не 10 микросервисов ради галочки**. Границы проведены там, где реально
разные lifecycle/нагрузки: auth+cards остаются в core, а realtime, OCR,
documents и outbox-consumer вынесены. Как дробить дальше — описано в §13.

### Что проверено

- API: **22 теста**;
- web: **5 тестов**;
- notifications: **5 тестов**;
- scan/OCR: **4 теста**;
- typecheck всех workspace-пакетов;
- production build всех сервисов;
- `npm audit --omit=dev`: **0 уязвимостей** в runtime-зависимостях;
- secret scan рабочего дерева: реальных токенов и приватных ключей нет;
  `.env.example` содержит только placeholder, который production-guard
  отвергает;
- вручную: refresh после удаления access-cookie, параллельный refresh, отзыв
  сессий, одноразовый WS ticket, cross-origin POST → 403, OCR по реальному PNG
  (`CRD-DEMO-01`, confidence 92%), OCR quota, **JetStream end-to-end**,
  DLQ/replay, PDF-акт с записью в S3, backup/restore, k6 25 VU / 50 с:
  9595 запросов, 0 ошибок, p95 18.9 ms, p99 < 500 ms;
- Docker не входит в текущий этап: compose-файл **не обновлён** под сервисный
  контур. Проверенный запуск — `start-demo.bat`.

## 2. Domain scenario

```
                 issue                return
  in_stock ──────────────► issued ──────────────► returned
     │                       │                        │
     │ write_off              │ (нельзя: сначала      │ restock
     ▼                       │  возврат)              ▼
 written_off ◄───────────────┘                    in_stock
     ▲
     └──── write_off из returned
```

- `issue` — только из `in_stock`, holder = активный manager;
- `return` — только из `issued`, вернуть может текущий holder (owner не override);
- `restock` — из `returned`;
- `write_off` — из `in_stock/returned`, причина обязательна;
- неверный переход → `409 INVALID_TRANSITION`;
- UI присылает `expectedVersion`, API проверяет его при наличии; row lock
  защищает и запросы без версии;
- `owner` — ответственный менеджер, `holder` — текущий держатель.

## 3. Stack

| Слой     | Выбор                                                                             |
| -------- | --------------------------------------------------------------------------------- |
| Web      | React 19, TypeScript, Vite 8, Tailwind 4, React Router, TanStack Query, RHF + Zod |
| Core API | TypeScript, Hono 4, Node 22, Zod, jose, Argon2id, Pino                            |
| Realtime | Hono WebSocket gateway, NATS, Redis Pub/Sub                                       |
| OCR      | Tesseract.js + traineddata, canvas/`getUserMedia` + jsQR fallback                 |
| DB       | PostgreSQL 17, Drizzle ORM, SQL migrations                                        |
| Infra    | Redis 5 Windows build, NATS 2.15, embedded PostgreSQL для локального runner       |
| Ops      | JSON backup/restore, autocannon, Redis trace spans, system alerts                 |
| Tests    | Vitest, Testing Library, реальный PostgreSQL + Redis                              |

Vite выбран вместо Next.js, потому что это внутренний SPA за авторизацией:
SSR/SEO не нужны, а Vite упрощает cookie/WS proxy и запуск демо.

## 4. Architecture

```
apps/web (React)
  ├─ /api  ──────────────────────────────► core API :8787
  ├─ /ocr-api ───────────────────────────► scan :8791  (Tesseract OCR)
  └─ /ws + HttpOnly ticket cookie ───────► notifications :8790
                                                   ▲
                                                   │ Redis Pub/Sub
                                        ┌──────────┴──────────┐
                                        │ notifications #2    │
                                        └──────────▲──────────┘
                                                   │ NATS queue
                                        ┌──────────┴──────────┐
                                        │ outbox worker       │
                                        └──────────▲──────────┘
                                                   │ SELECT ... SKIP LOCKED
core API ── transaction ──► PostgreSQL (cards, operations, outbox)
   │                              │
   └── Redis: sessions, rate, traces, wake signal
```

### Core API

- `http/routes` — HTTP, Zod, cookies;
- `http/middleware` — requestId/trace, body limit, authN, origin;
- `modules/auth` — Argon2id, access JWT, refresh rotation, session store;
- `modules/cards` — state machine, row lock, object scope, idempotency;
- `modules/users` — admin CRUD, роли, склады;
- `modules/outbox` — запись события в бизнес-транзакции;
- `modules/dashboard/audit` — scoped counters и append-only журнал;
- Redis — rate limit, sessions, distributed wake.

### Notifications

- принимает WebSocket, аутентифицируя **одноразовый** ticket из HttpOnly cookie
  `cardops_ws_ticket` (Path=/ws, 2 минуты, `jti` удаляется из Redis атомарно);
- проверяет `sid` из ticket в Redis, поэтому отозванная сессия не откроет сокет;
- проверяет `Origin` до upgrade;
- фильтрует события по admin/warehouse/manager scope;
- один экземпляр из NATS queue получает событие и публикует в Redis;
- **все** экземпляры notifications читают Redis и рассылают своим клиентам;
- отзыв сессии приходит через Redis и закрывает сокеты пользователя.

### OCR scan

- `POST /ocr` multipart image;
- проверяет access JWT, Redis-сессию и `Origin`;
- per-user Redis quota (10 запросов / 60 секунд по умолчанию), иначе 429;
- принимает только PNG/JPEG/BMP/TIFF и сверяет magic bytes с MIME;
- Tesseract.js извлекает текст и SKU;
- **не принимает бизнес-решений**: код уходит обратно в UI, затем в обычный
  `/api/scan`, где API проверяет scope и статус.

### Documents

- отдельный процесс, внутренний токен, наружу не публикуется;
- core API проверяет object scope и передаёт снимок карты;
- PDFKit/pdf-lib + Noto Sans (кириллица), акт по карте;
- PDF сохраняется в MinIO/S3 bucket `cardops-documents`;
- локальный no-Docker runner поднимает S3-совместимый `s3rver`, в production
  тот же код работает с MinIO через S3 API.

### Outbox worker

- отдельный процесс;
- lease через `FOR UPDATE SKIP LOCKED`;
- публикует `{id, ...payload}` в **JetStream** stream `CARDOPS`;
- после `PubAck` помечает событие processed;
- backoff, `last_error`, DLQ после 10 попыток;
- replay DLQ из `/api/system` сбрасывает событие в очередь;
- heartbeat в Redis для alerts.

## 5. AuthN / AuthZ

1. **Access JWT** — 15 минут, HttpOnly `cardops_session`, `sid` = refresh family.
2. **Refresh token** — 30 дней, HttpOnly `cardops_refresh`, path `/api/auth`.
   В БД хранится только SHA-256 хеш.
3. **Rotation:** refresh выдаёт новую пару и отзывает старую запись. Повторное
   использование старого refresh → revoke всей family + всех Redis-сессий.
4. **Revocation:** logout и admin «отозвать сессии» удаляют Redis session и
   ставят tombstone с timestamp. `SessionStore.isActive` сравнивает его с
   `createdAt` сессии, поэтому refresh, начавшийся до отзыва, не воскрешает
   доступ. Access сразу получает 401; notifications закрывает WebSocket
   пользователя.
5. **Role/object scope:** JWT говорит identity, но роль/склад читаются из БД на
   каждом запросе; object-level правило отдельное.

### Security model: attack → control → residual risk

| Вектор                            | Контроль                                                                                                 | Остаточный риск                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Brute force / credential stuffing | Redis limit на login+IP+account, Argon2id, одинаковый ответ и dummy-hash для неизвестного логина         | Распределённый ботнет по многим IP; нужен WAF/бот-защита    |
| Кража access JWT                  | 15 минут, HttpOnly, `Secure` в production, Redis-сессия проверяется на каждом запросе, revoke мгновенный | XSS/скомпрометированный браузер до истечения TTL            |
| Кража refresh token               | В БД только SHA-256, path `/api/auth`, rotation, reuse detection отзывает всю family                     | Кража обоих cookie через malware                            |
| Session fixation                  | Новая family на login, `sid` в JWT, server-side Redis session                                            | —                                                           |
| CSRF                              | `SameSite=Lax`, Origin allowlist на POST/PATCH/DELETE, JSON-body                                         | Старые браузеры без SameSite (не target)                    |
| XSS                               | React escaping, нет `dangerouslySetInnerHTML`, CSP + nosniff + frame-deny                                | Сторонняя зависимость с DOM-XSS                             |
| SQL injection                     | Drizzle parameterized queries, Zod на границе, нет конкатенации SQL с вводом                             | Ошибка в raw-SQL (сейчас только ops-скрипты)                |
| IDOR / horizontal access          | Object scope в repo/service, повторная проверка scope при idempotent replay                              | Ошибка в новом endpoint без scope-теста                     |
| Privilege escalation              | Capability-RBAC, роль/склад перечитываются из БД, self-role и last-admin guards                          | Компрометация admin-аккаунта                                |
| WebSocket hijack / replay         | Одноразовый ticket в HttpOnly `Path=/ws`, 2 минуты, `jti` в Redis, `sid`-проверка, Origin                | Кража cookie через malware                                  |
| OCR abuse / parser attack         | Auth, per-user quota, 8 MB, MIME + magic bytes, один Tesseract-worker                                    | CPU-нагрузка при распределённом флуде легальными аккаунтами |
| Секреты в repo                    | `.env`/`.data` в `.gitignore`, production отказывается стартовать с demo-secret, secret scan             | Человеческий фактор при новом конфиге                       |
| Утечка realtime-данных            | Фильтр visibility на сервере: admin / warehouse / manager                                                | Ошибка в правиле visibility                                 |
| Отзыв сессии                      | Redis Pub/Sub закрывает WebSocket; heartbeat раз в 10 с перепроверяет `sid` в Redis                      | Pub/Sub доставляется за миллисекунды, fallback — до 10 с    |

Осознанно **не** заявляется как закрытое: MFA/OIDC, key rotation, WAF,
антивирус для uploads, encrypted backups, WORM-аудит. Это перечислено в
trade-offs, а не спрятано.

| Действие               | admin |            manager |                  warehouse |
| ---------------------- | ----: | -----------------: | -------------------------: |
| Смотреть карты         |   все |       owner/holder |                 свой склад |
| Создать/выдать/списать |    да |                нет |                 свой склад |
| Вернуть                |    да | только holder=self |                 свой склад |
| Журнал                 |   всё |    доступные карты |                 свой склад |
| Пользователи           |  CRUD |                нет | только managers для выдачи |
| System                 |    да |                нет |                        нет |

UI скрывает кнопки, но API проверяет всё заново. Чужой scan → 404, чужой
detail → 403 (осознанный выбор, описан в trade-offs).

## 6. Consistency + idempotency

В одной транзакции:

```sql
SELECT ... FROM cards WHERE id = $1 FOR UPDATE;
-- state machine + expectedVersion
UPDATE cards ...;
INSERT INTO operations ...;       -- append-only audit
INSERT INTO outbox_events ...;    -- durable event
COMMIT;
```

- `operations` защищена trigger от UPDATE/DELETE; `TRUNCATE` — отдельный
  destructive путь, доступный только ops/тестам.
- `Idempotency-Key` обязателен для create/transitions:
  - reserve key в той же транзакции;
  - concurrent duplicate ждёт unique index;
  - replay возвращает сохранённый ответ;
  - другой payload → 422;
  - handler error откатывает и ключ, и бизнес-изменение.
- Перед replay повторно проверяется текущий object scope, чтобы отозванный
  доступ не получил старый DTO.
- `version` + row lock + conditional checks.

## 7. Outbox, NATS and realtime

1. Core transaction пишет `outbox_events`.
2. `outbox-worker` lease-ит события и публикует в **NATS**.
3. Notifications (queue group) получает событие.
4. Notifications публикует его в **Redis Pub/Sub**.
5. Каждый notifications-инстанс рассылает событие своим WebSocket-клиентам.
6. Клиент инвалидирует TanStack Query и перезапрашивает REST; WS не является
   источником бизнес-данных.
7. Outbox + **JetStream** дают end-to-end at-least-once: worker ждёт
   `PubAck`, notifications ack-ает сообщение только после Redis publish.
   Если notifications недоступен, сообщение остаётся у durable consumer.
8. После 10 неудачных попыток worker переводит событие в **DLQ**
   (`dead_lettered_at`), а админ может сделать replay из `/api/system`.
9. Клиент дедуплицирует по `event.id`; повторная доставка не создаёт второй
   эффект.

Durable consumer `notifications` общий для нескольких инстансов: каждый
забирает свою пачку, ack общий.

### Observability / SLO

- core API отдаёт `/metrics` в Prometheus-формате;
- метрики: request rate, p95/p99, 4xx/5xx, outbox pending/DLQ/lag, WS
  connections, worker heartbeat, NATS up;
- `observability/prometheus.yml` — scrape каждые 5 секунд;
- `observability/grafana/dashboards/cardops.json` — готовый dashboard;
- `observability/k6.js` — нагрузочный сценарий с порогами
  `5xx < 1%`, `p95 < 200 ms`, `p99 < 500 ms`; проверено 25 VU / 50 с,
  9595 запросов, 0 ошибок, p95 18.9 ms;
- локальный запуск Grafana/Prometheus/k6 описан в `observability/README.md`.

## 8. OCR / mobile scanner

- ручной ввод SKU;
- камера: `getUserMedia`, QR через `BarcodeDetector` или jsQR fallback,
  Code 128 — при наличии native decoder;
- фото: Tesseract.js OCR → SKU → обычный server resolve;
- если камеры нет: диагностика `videoinput: 0`, загрузка фото, ручной ввод;
- PWA manifest + service worker (offline queue — roadmap).

Demo QR: `/demo-qr.svg` → `CRD-DEMO-01`. Полный набор реальных и фейковых
QR/Code 128 с подписями лежит в `demo-codes/` (не подключён к сайту).

## 9. Quick start

### Windows, без Docker

```bat
start-demo.bat
```

Runner:

- скачивает Redis/NATS Windows binaries в `.data/bin` при первом запуске;
- первый OCR скачивает `eng.traineddata` в `.data/tessdata` (нужна сеть) или
  можно положить файл туда заранее;
- поднимает Redis 6379 и NATS 4222 с JetStream (или переиспользует запущенные);
- поднимает S3-совместимый store на 9000 (MinIO API) и embedded PostgreSQL 17;
- применяет миграции и seed;
- запускает core API, notifications, scan, documents, outbox-worker и web;
- пишет `.data/demo-pids.json` и запускает watchdog;
- открывает `http://127.0.0.1:5173`.

Остановка:

```bat
stop-demo.bat
```

`Ctrl+C` тоже останавливает весь контур. Watchdog добивает процессы, если
launcher умер аварийно.

Полезные команды:

```bash
npm run typecheck
npm test
npm run build
npm run db:reset
npm run db:backup
npm run db:restore -- .data/backups/cardops-<stamp>.json
npm run load:test
```

Демо-пользователи: `admin/admin123`, `manager/manager123`,
`warehouse/warehouse123`.

### Docker

Docker **не входит в текущий этап**. `docker-compose.yml` оставлен с базовым
контуром, но не содержит Redis/NATS/notifications/scan/worker. Для этого demo
используйте локальный runner.

## 10. Demo script (4–5 минут)

1. **Login** — admin/admin123. Dashboard: 8 карт, live-статус.
2. **Создать карту** — MSK, last4; открыть карточку.
3. **Выдать** менеджеру. Проверить audit, version, dashboard realtime.
4. **Повторить запрос** из toast → `replayed: true`, второго эффекта нет.
5. **Audit** — actor, action, from→to, timestamp.
6. **Manager** — видит только свои 3 карты, чужой URL → 403.
7. **Warehouse** — только WH-MSK, чужой склад → 403/404.
8. **Admin → Пользователи** — создать/изменить/деактивировать, отозвать сессии.
9. **Refresh** — удалить `cardops_session` в DevTools, обновить страницу:
   access восстановится через refresh cookie; удалить refresh → login.
10. **OCR** — «Распознать фото», выбрать изображение с `CRD-DEMO-01`; Tesseract
    вернёт SKU, затем откроется карта. QR: `/demo-qr.svg` или QR с текстом SKU.
11. **System** — outbox, worker heartbeat, NATS, WS subscribers, alerts, traces.
12. **Realtime fanout** — при желании запустить второй notifications на 8793;
    событие получат оба.

### Curl: refresh + idempotency

```bash
# login (cookies.txt keeps both HttpOnly cookies)
curl -s -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"admin123"}' \
  http://127.0.0.1:8787/api/auth/login

curl -s -b cookies.txt -c cookies.txt -X POST \
  http://127.0.0.1:8787/api/auth/refresh

# create + issue with stable keys
curl -s -b cookies.txt -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-create-1' \
  -d '{"title":"Curl card","warehouseId":"<WH_MSK_ID>","last4":"4242"}' \
  http://127.0.0.1:8787/api/cards
```

## 11. API

| Метод          | Путь                                   | Доступ                            |
| -------------- | -------------------------------------- | --------------------------------- |
| POST           | `/api/auth/login`                      | public                            |
| POST           | `/api/auth/refresh`                    | refresh cookie                    |
| POST           | `/api/auth/logout`                     | public/clear                      |
| GET            | `/api/auth/me`                         | auth                              |
| POST           | `/api/auth/realtime-ticket`            | auth, single-use 2m cookie        |
| GET/POST/PATCH | `/api/admin/users`                     | admin                             |
| POST           | `/api/admin/users/:id/revoke-sessions` | admin                             |
| GET            | `/api/cards`                           | auth + scope                      |
| POST           | `/api/cards`                           | admin/warehouse + Idempotency-Key |
| GET            | `/api/cards/:id`                       | auth + object scope               |
| POST           | `/api/cards/:id/transitions`           | role/object + Idempotency-Key     |
| POST           | `/api/cards/:id/act`                   | auth + object scope → PDF         |
| POST           | `/api/system/outbox/replay`            | admin, replay DLQ                 |
| GET            | `/api/audit`                           | auth + scope                      |
| GET            | `/api/dashboard`                       | auth + scope                      |
| POST           | `/api/scan`                            | auth + scope                      |
| POST           | `/ocr-api/ocr`                         | access cookie + Redis session     |
| POST           | `/documents/act`                       | internal token, core → documents  |
| GET            | `/api/system`                          | admin                             |
| GET            | `/api/health`                          | public                            |
| WS             | `/ws`                                  | HttpOnly ticket cookie            |

Ошибки: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `UNAUTHORIZED`, `FORBIDDEN`,
`INVALID_ORIGIN`, `NOT_FOUND`, `CONFLICT`, `INVALID_TRANSITION`,
`VERSION_CONFLICT`, `IDEMPOTENCY_*`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## 12. Tests

```bash
npm test
```

> Запускайте тесты только из корня. `apps/api/test/global-setup.ts` отказывается
> работать с БД, которая не выглядит одноразовой, поэтому прямой
> `npm run test -w @cardops/api` не может случайно очистить demo-базу.

- API: **22** — auth/refresh rotation/reuse, session revoke, admin CRUD,
  self-lockout/last-admin guards, CSRF Origin, WS ticket cookie, RBAC, object
  scope, idempotency, concurrent duplicates, state machine, audit trigger,
  outbox row, dashboard/scan.
- Web: **5** — role affordances, status UI.
- Notifications: **5** — admin/warehouse/manager visibility, session close.
- Scan: **4** — SKU extraction from noisy OCR text, magic-byte validation.

Ожидаемо:

```
API            Tests 22 passed
Web            Tests 5 passed
Notifications  Tests 5 passed
Scan           Tests 4 passed
```

Дополнительно вручную: два WS-инстанса получили одно событие; OCR вернул
`CRD-DEMO-01` с confidence 92%; rate limit: 10×401 → 11×429; single-use WS
ticket; cross-origin POST → 403; backup/restore; k6 smoke без ошибок
(p95 18.9 ms).

## 13. Trade-offs / roadmap

- **Не 10 сервисов.** Core (identity+cards+audit) остаётся модульным монолитом.
  Причина: split identity/cards потребует sagas/outbox для пользовательских
  данных и даст больше распределённой сложности, чем пользы для demo. Реальные
  границы уже вынесены: realtime, OCR, documents, outbox-worker.
- **Один PostgreSQL.** В production — отдельная БД/схема и права на сервис.
- **Redis/NATS локальные binaries**, не кластер. JetStream уже даёт durable
  stream, ack и DLQ; production — 3-node NATS и managed Redis.
- **Документы**: локальный runner использует S3-совместимый `s3rver`, код
  работает через MinIO client; production — MinIO/S3 с versioning и KMS.
- **Refresh/access в cookie**, без OIDC/SSO; для enterprise — OIDC, key rotation,
  session version.
- **Rate limit фиксированное окно в Redis**, не sliding-window cluster.
- **OCR — Tesseract**, не специализированная ML-модель; нет PAN redaction.
- **Alerts вычисляются в `/api/system`**, без PagerDuty/Alertmanager.
- **Tracing — correlation spans в Redis**, не OpenTelemetry/Jaeger.
- **Backup — JSON snapshot** бизнес-таблиц, не PITR/WAL.
- **Load test — k6/autocannon smoke**, не capacity planning.
- **Audit trigger ≠ WORM**: нет защиты от `TRUNCATE`/superuser.
- **Docker** не обновлён под сервисный контур.
- **In-memory / Redis** session keys требуют TTL purge для старых family.
- **Нет MFA/OIDC/WAF** и антивируса для uploads; OCR проверяет формат по magic
  bytes, но не является sandbox для вредоносных файлов.
- **JWT — HS256 с одним секретом**, без key rotation; для production нужен
  KMS/secret manager и план ротации.
- **Dev-only audit**: `npm audit` без `--omit=dev` показывает 7 moderate в
  drizzle-kit/esbuild-kit и autocannon/uuid; runtime-зависимости чистые.
- **Backup не шифруется** и содержит PII; для production — KMS + PITR.

## 14. Bun readiness

Core Hono-код, Zod, jose и postgres.js совместимы с Bun; Node-only bootstrap
(`@hono/node-server`, `@hono/node-ws`) изолирован. Новые сервисы используют
`tesseract.js`, `nats`, `ioredis`; для Bun нужен отдельный bootstrap и проверка
NAPI/worker-совместимости. В CI сейчас Node 22.

## 15. Project tree

```
.
├─ apps/
│  ├─ api/                     core API: auth, cards, audit, dashboard, admin users
│  ├─ web/                     React SPA
│  └─ …
├─ services/
│  ├─ notifications/           WS gateway + JetStream consumer + Redis fanout
│  ├─ scan/                    Tesseract OCR
│  ├─ documents/               PDF act + MinIO/S3 storage
│  └─ outbox-worker/           outbox → JetStream + DLQ
├─ packages/shared/            Zod contracts, state machine, permissions
├─ demo-codes/                 real/fake QR + Code 128 + README (not served)
├─ observability/              Prometheus, Grafana dashboard, k6 scenario
├─ .assets/screens/            screenshots for portfolio/README
├─ scripts/                    dev/infra/test/backup/restore/load/stop/watchdog
├─ .data/bin/                  локальные Redis/NATS binaries (gitignored)
├─ start-demo.bat
├─ stop-demo.bat
└─ README.md
```

## 16. Key files

1. `apps/api/src/modules/auth/auth.service.ts` — login, refresh rotation, reuse
   detection, session revocation.
2. `apps/api/src/modules/cards/cards.service.ts` — transactional state machine,
   idempotency, audit+outbox.
3. `apps/api/src/modules/cards/cards.repo.ts` — object scope + `FOR UPDATE`.
4. `services/notifications/src/index.ts` — ticket auth, NATS→Redis→WS fanout,
   distributed instances.
5. `services/outbox-worker/src/index.ts` — lease, JetStream publish, DLQ, backoff.
6. `services/documents/src/pdf.ts` — PDF act with Cyrillic font.

Бонус: `services/scan/src/ocr.ts` — OCR + SKU extraction without business logic.
