# Async Order

## Overview
Async Order is a backend service for managing orders that are processed asynchronously.
A client can create an order, query its current state, list their orders, and cancel an order while it is still pending.
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

## Tech Stack

- NestJS
- PostgreSQL
- RabbitMQ
- TypeORM
- Docker

## Architecture

The API is responsible for accepting and validating requests and persisting the initial order state.
Order processing is performed asynchronously through RabbitMQ workers.

Basic flow:

`Client -> API -> PostgreSQL -> RabbitMQ -> Worker -> Payment Provider`

More detailed architecture decisions are documented in [`docs/system-design.md`](./docs/system-design.md).

## Main Engineering Challenges

This project focuses on:

- Asynchronous order processing.
- Reliable message consumption.
- Retry strategies.
- Idempotent order creation.
- Concurrent worker execution.
- Database transactions and consistency.
- Failure handling.
- Query optimization and indexing.

## API

### Create Order
`POST /orders`

### Get Order
`GET /orders/:id`

### List Orders
`GET /orders`

### Cancel Order
`POST /orders/:id/cancel`

## Running Locally

Requirements:

- Node.js
- Docker
- Docker Compose

```bash
npm install
cp .env.example .env
docker compose up -d --wait
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
or indexes. Schema migrations are not configured yet.

`SchemaValidator` blocks startup if TypeORM proposes schema changes, without
executing them. Initial SQL and setup instructions are in
[`scripts/sql/README.md`](./scripts/sql/README.md). Both tables use `DEFAULT now()`
for `created_at` and `updated_at` on insert; direct SQL updates must set
`updated_at` explicitly (there is no update trigger). Accounts have no `version`
column.

`QueueModule` exports a Nest `ClientProxy` under the `ORDER_QUEUE_CLIENT` token
for a durable `orders` queue (override with `RABBITMQ_QUEUE`). Import `QueueModule`
in modules that inject this client. Its connection is lazy: it connects on the
first operation or an explicit `client.connect()`. No worker is registered yet.
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
