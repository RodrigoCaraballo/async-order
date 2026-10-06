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
docker compose up -d
npm run start:dev
```

## Documentation

Additional technical documentation can be found under `/docs`:

- `system-design.md`
- `concurrency.md`
- `failure-scenarios.md`
- `ai-usage.md`
- `adr/`

## Project Status

Currently under development.