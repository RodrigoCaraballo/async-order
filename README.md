# Async Order

## Overview
Async Order is a backend service for managing orders that are processed asynchronously.
Order creation, querying, listing, and cancellation are implemented. Worker processing is in progress.
The main goal of this project is to explore reliable asynchronous processing, database consistency, retries, concurrency, and idempotency in a backend system.

## Scope

The system allows a client to:

- Create an order.
- Retrieve an order by ID.
- Retrieve all their orders.
- Cancel an order while it is still pending.

## Order Lifecycle

An order can move through the following states:

`PENDING -> PROCESSING -> PAID`

Depending on the execution result, an order may also become:

- `FAILED`
- `CANCELLED`

The intended processing path follows the current use-case switch:

```text
PENDING_CREATED
  → PROCESSING_STARTED
  → PROCESSING_ACCOUNT_VALIDATED
  → PAID_COMPLETED
```

The worker checks that the order is still eligible, validates that the account
exists and is active and valid, attempts payment, and records the final result.
`PROCESSING_ACCOUNT_VALIDATED` records account eligibility, not a balance check
or a completed debit. Payment must still check sufficient funds and current
account eligibility when applying the debit. `PAID_COMPLETED` and
`CANCELLED_BY_USER` end processing without repeating effects.

The payment path does not use separate debit/request/confirmation checkpoints.
Those older values remain in the enum and database checks; this documentation
change does not remove them from the schema. Failed, paid, and cancelled terminal
steps end processing without attempting another debit.

Account active/valid fields, the complete payment handler, transaction boundaries,
remain to be completed. Consumer acknowledgement and bounded retries are implemented. A local
debit and the final paid state must commit together to prevent duplicate debits
on redelivery. An external provider would additionally require idempotency using
the order ID.

## Tech Stack

- NestJS
- PostgreSQL
- RabbitMQ
- TypeORM
- Docker

## Architecture

The API is responsible for accepting and validating requests and persisting the initial order state.
Order creation persists a `PENDING` order and publishes an `order.created` event
with `{ orderId, retryCount: 0 }` to RabbitMQ. The RMQ consumer and processing use case are
under development; the end-to-end payment flow is not complete.

Basic flow:

`Client -> API -> PostgreSQL -> RabbitMQ -> Worker -> Payment Provider`

More detailed architecture decisions are documented in [`docs/system-design.md`](./docs/system-design.md).

## Main Engineering Challenges

This project focuses on:

- Asynchronous order processing.
- Reliable message consumption.
- Retry strategies.
- Duplicate suppression during order creation and idempotent worker processing.
- Concurrent worker execution.
- Database transactions and consistency.
- Failure handling.
- Query optimization and indexing.

## API

### Create Order
`POST /orders`

```json
{
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "accountId": "a27ac10b-84cc-4372-a567-0e02b2c3d111",
  "amount": 120.50,
  "currency": "USD"
}
```

No client idempotency header is required. `CreateOrderInterceptor` generates a
SHA-256 `idempotencyKey` from the canonical JSON body and a fresh UUID `traceId`
for each request. Object property order does not affect the hash; array order
and body values do. The trace is returned as `X-Trace-Id` and passed to the use
case for logging; it is not persisted or included in the RabbitMQ event.

Successful creation returns HTTP `201 Created`:

```json
{ "orderId": "generated-order-uuid", "status": "pending" }
```

Persisted statuses and processing steps use uppercase values. The current
creation response uses lowercase `pending`.

Duplicate handling:

- An identical body returns `409 Conflict` during a 10-second window from the
  first accepted request. The interceptor uses a local `Map` with `setTimeout`;
  duplicates do not extend the TTL, and failed requests retain their entry.
- After the TTL, an identical `PENDING` or `PROCESSING` order still returns 409.
  Different bodies may create multiple active orders for the same user.
- An identical payment can be created again once the TTL expires and the previous
  order is terminal, even if the user has other active orders.
- A PostgreSQL partial unique index enforces active-key uniqueness across
  instances. The Map is per instance and is lost on restart.

This policy suppresses active duplicates; it does not replay the original
response or guarantee permanent idempotency for retries after completion.
If publication fails after persistence, the order remains active; retrying the
HTTP request does not republish it. Publication recovery is still pending.

The global `InternalServiceErrorFilter` maps `CONFLICT` to 409 and `NOT_FOUND`
to 404, preserving domain messages. Unknown internal codes return a generic
500. Existing Nest exceptions retain their behavior. PostgreSQL uniqueness
violations for the active idempotency index are translated to domain conflicts.

Creation uses `class-validator` and a request-body `ValidationPipe`: both IDs
must be UUIDs, amount must be a positive JSON number with at most two decimal
places and no greater than `9999999999.99`, and currency must be three uppercase
letters. Missing/invalid values and additional fields return 400.

### Get Order
`GET /orders/:id`

Requires `X-User-Id: <UUID>` as fake authorization and looks up the order by ID
only, independently of its user. An absent order returns 404. The response includes `id`,
`accountId`, `status`, `processingStep`, `amount`, `currency`, and timestamps.

### List Orders
`GET /orders`

Requires `X-User-Id: <UUID>`. Optional query parameters: `page` (default 1),
`limit` (default 20, maximum 100), and uppercase `status`. Returns
`{ items, page, limit, total }`, ordered by newest creation first.
The list includes orders from all users; the header does not filter results.

### Cancel Order
`POST /orders/:id/cancel`

Requires `X-User-Id: <UUID>`. Returns 200 with
`{ id, status: "CANCELLED", processingStep: "CANCELLED_BY_USER" }`. Cancellation
uses one conditional UPDATE by order ID in `PENDING` and
`PENDING_CREATED`, independently of its user. An absent order returns 404; an order that
cannot be cancelled returns 409, including a repeated cancellation.

`FakeAuthorizationGuard` checks that `X-User-Id` is present and is a UUID.
This simulates authorization; it does not authenticate or check ownership.
The value is not passed to use cases or repository methods. Missing or invalid UUIDs and invalid
pagination/status parameters return 400.

## Running Locally

Requirements:

- Node.js
- Docker
- Docker Compose

```bash
npm install
cp .env.example .env
docker compose up -d --wait
# Initialize a fresh database before starting Nest (see scripts/sql/README.md).
docker compose cp ./scripts/sql/001-create-schema.sql postgres:/tmp/001-create-schema.sql
docker compose exec -T postgres psql -U async_order -d async_order -v ON_ERROR_STOP=1 -f /tmp/001-create-schema.sql
npm run start:dev
```

Compose runs only PostgreSQL and RabbitMQ; NestJS runs on the host. These
development credentials are not suitable for production. Ports are bound to
localhost only.

- PostgreSQL: `localhost:5432`, database/user `async_order`, password `local_postgres_password`.
- RabbitMQ: `amqp://async_order:local_rabbitmq_password@localhost:5672`.
- RabbitMQ management UI: http://localhost:15672, user `async_order`, password `local_rabbitmq_password`.

On PowerShell, use `Copy-Item .env.example .env` instead of `cp`.
Nest loads `.env` through `ConfigModule`; existing environment variables take
precedence. `DATABASE_URL` and `RABBITMQ_URL` are required.

`DatabaseModule` registers PostgreSQL and the order/account entities with
`synchronize: false`: startup connects to PostgreSQL but does not create tables
or indexes. There is no automatic migration runner; SQL scripts are applied
manually. For a database using the old globally unique `idempotency_key`, apply
`002-active-order-idempotency.sql` instead of rerunning the initial schema.
If the database has `unique_active_order_per_user`, also apply
`003-remove-active-order-per-user.sql` to allow different active orders for the
same user. Fresh databases created with the current initial schema need neither
upgrade script.

`SchemaValidator` blocks startup if TypeORM proposes schema changes, without
executing them. Initial SQL and setup instructions are in
[`scripts/sql/README.md`](./scripts/sql/README.md). Both tables use `DEFAULT now()`
for `created_at` and `updated_at` on insert; direct SQL updates must set
`updated_at` explicitly (there is no update trigger). Accounts have no `version`
column.

`QueueModule` exports a Nest `ClientProxy` under the `ORDER_QUEUE_CLIENT` token
for a durable `orders` queue (override with `RABBITMQ_QUEUE`). Import `QueueModule`
in modules that inject this client. Its connection is lazy: it connects on the
first operation or an explicit `client.connect()`. The event controller and
processing use case are registered; the payment consistency guarantees above
remain to be completed.

### RabbitMQ retries

`orders.retry` (override with `RABBITMQ_RETRY_QUEUE`) is a durable queue with a
fixed 5-second message TTL and dead-letter routing back to the main queue. It
has no consumer or application timer. Retry publication uses Nest's confirmed
RMQ publisher; the original is acknowledged only after publication completes.
The broker's dead-letter mechanism provides the return route; there is no final
failure DLQ. Classic-queue dead-letter transfer is not itself publisher-confirmed,
so this setup does not guarantee loss-free transfer during broker failures.

Messages start with `retryCount: 0`; legacy messages without the field also
start at zero. Retryable and unexpected errors schedule up to three retries
(four executions total). NOT_FOUND, BAD_REQUEST, persisted payment failure and
insufficient funds are logged and acknowledged without retry. On exhaustion,
the event is logged and discarded, preserving the order's current state.
If retry publication fails, the original is negatively acknowledged with
requeue enabled; this exceptional recovery path has no TTL delay.
Queue declaration is lazy on the first retry. Keep the retry queue name distinct
from the main queue. Existing queues must have matching arguments.
Use Nest RMQ message envelopes when publishing to a Nest RMQ consumer, not raw
AMQP payloads.

Use `docker compose ps` to check services and `docker compose logs -f` to inspect
logs. `docker compose down` stops services while preserving data in named volumes.
`docker compose down -v` also **deletes all local database and broker data**.
PostgreSQL initialization credentials apply only when its data volume is empty;
changing them in Compose does not update an existing database.

## Documentation

Additional technical documentation can be found under `/docs`:

- `system-design.md`
- `concurrency.md`
- `failure-scenarios.md`
- `ai-usage.md`
- `adr/`

## Project Status

Currently under development.
