# hire-wire

A small invoicing service. Invoices are created over HTTP, approved or rejected by a person, then
charged and marked paid. A [Temporal](https://temporal.io) workflow drives each invoice through its
lifecycle; Postgres stores the invoices.

```
                 approve           charge ok
pending_approval ───────▶ approved ─────────▶ paid
       │                     │
       │ reject              │ charge declined
       ▼                     ▼
    rejected           payment_failed
```

## Layout

| Package                | What it holds                                                                |
| ---------------------- | ---------------------------------------------------------------------------- |
| `apps/api`             | Fastify HTTP API. Validates input with zod, talks to Postgres and Temporal.  |
| `apps/worker`          | Temporal worker: activities that update invoices and charge them.            |
| `packages/workflows`   | The invoice workflow and the update/query definitions the API calls.         |
| `packages/db`          | SQL migrations, the migration runner, and the invoice repository.            |

A few choices worth knowing about:

- **Money is integer cents** (`bigint` columns, `totalCents` / `unitPriceCents` in JSON).
- **Status only changes through the workflow.** Each change is a single
  `UPDATE ... WHERE status = <expected>`, so two concurrent changes cannot both win.
- **Approve and reject are workflow updates**, not signals. The workflow refuses a second decision
  before it is recorded, so the API can answer `409` straight away. They also start the workflow if
  it is not running yet, which covers a create request that saved the invoice but failed to reach
  Temporal.
- **Charging is idempotent.** The invoice id is the payment idempotency key, so a retried activity
  never charges twice. The payment provider is a fake; currency `XXX` is always declined.
- **No build step.** Node 24 runs the TypeScript sources directly.

## Run it

Requires Docker.

```bash
docker compose up --build
```

This starts Postgres, a Temporal dev server, runs migrations, then starts the API on
<http://localhost:3000> and the worker. The Temporal UI is on <http://localhost:8233>.

```bash
# create
curl -s -X POST localhost:3000/invoices -H 'content-type: application/json' -d '{
  "customerName": "Acme Ltd",
  "customerEmail": "billing@acme.test",
  "currency": "EUR",
  "lineItems": [{ "description": "Consulting", "quantity": 3, "unitPriceCents": 12500 }]
}'

# approve (or /reject), then fetch
curl -s -X POST localhost:3000/invoices/<id>/approve
curl -s localhost:3000/invoices/<id>

# list, optionally by status
curl -s 'localhost:3000/invoices?status=paid&limit=10'
```

| Method | Path                     | Result                                                        |
| ------ | ------------------------ | ------------------------------------------------------------- |
| POST   | `/invoices`              | `201` invoice in `pending_approval`; `400` with field issues   |
| GET    | `/invoices`              | `{ invoices }`, newest first; `status`, `limit` (1–100)        |
| GET    | `/invoices/:id`          | invoice with line items; `404` if unknown                      |
| POST   | `/invoices/:id/approve`  | `200` invoice; `409` if already decided; `404` if unknown      |
| POST   | `/invoices/:id/reject`   | `200` invoice; `409` if already decided; `404` if unknown      |
| GET    | `/health`                | `{ status: "ok" }` once the database answers                   |

## Discounts

Pending invoices can take one discount code. `WELCOME10` (10% off) is seeded by the migrations.

```bash
curl -s -X POST localhost:3000/invoices/<id>/discount -H 'content-type: application/json' -d '{ "code": "WELCOME10" }'
```

`409` means the code is unknown, used up, or the invoice is no longer pending.

## Invoice pages

Open <http://localhost:3000/admin/login> and log in with `ADMIN_TOKEN` (default `changeme`). From
there, <http://localhost:3000/invoices/view> lists invoices; each invoice has a printable page with an
Approve button. Once an invoice is approved, the worker emails the customer before charging.

## Develop

Requires Node 24 and Docker (tests start Postgres in a container and a local Temporal server).

```bash
corepack enable
yarn install
yarn test        # unit + integration tests
yarn lint        # oxlint
yarn typecheck   # tsc
```

To run the processes outside Docker, start Postgres and Temporal with
`docker compose up postgres temporal`, then:

```bash
export DATABASE_URL=postgres://invoices:invoices@localhost:5433/invoices
yarn migrate
node apps/api/src/server.ts
node apps/worker/src/worker.ts
```
