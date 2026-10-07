# Async Order - System Design

## Functional Requirements

The system must allow a user to:

- Create an order associated with an account to be debited.
- Retrieve an order by ID.
- Retrieve all their orders.
- Cancel an order while it is still pending.
- Track the current status of an order.

Once an order is created, the payment process must be executed asynchronously.

### Active Order Constraint

A user can have only one active order at a time.

An order is considered active when its status is:

- `PENDING`
- `PROCESSING`

A user cannot create another order until the current active order reaches a terminal state:

- `PAID`
- `FAILED`
- `CANCELLED`

### Account Balance Constraint

Every order must reference the account that will be debited.

Before completing the payment, the system must verify that the selected account has enough balance to pay the order amount.

An account balance must never become negative.

Multiple orders may reference the same account. Therefore, concurrent workers may attempt to debit the same account at approximately the same time.

The system must guarantee balance integrity under concurrent operations.

Example:

```text
Account balance: 100

Order A: 80
Order B: 70

Both orders start processing concurrently.

Valid result:

Order A -> PAID
Order B -> FAILED (INSUFFICIENT_FUNDS)

Account balance -> 20
```

The following result must never happen:

```text
Order A -> PAID
Order B -> PAID

Account balance -> -50
```

---

## Order State Model

The order exposes a high-level `status` representing its business state:

- `PENDING`
- `PROCESSING`
- `PAID`
- `FAILED`
- `CANCELLED`

Additionally, each order contains a `processingStep` representing the exact internal point reached by the order-processing workflow.

Processing steps follow the convention:

```text
STATUS_STEP
```

Examples:

```text
PENDING_CREATED
PROCESSING_STARTED
PROCESSING_ACCOUNT_VALIDATED
PROCESSING_ACCOUNT_DEBITED
PROCESSING_PAYMENT_REQUESTED
PROCESSING_PAYMENT_CONFIRMED
PAID_COMPLETED
FAILED_INSUFFICIENT_FUNDS
FAILED_PAYMENT
CANCELLED_BY_USER
```

The `status` represents the external business state.

The `processingStep` represents the internal processing state.

Example:

```text
status: PROCESSING
processingStep: PROCESSING_ACCOUNT_DEBITED
```

This means that the order is still processing, but the system knows that the associated account has already been debited.

The processing step is persisted in PostgreSQL and is therefore part of the durable order state.

It can be used for:

- debugging;
- observability;
- recovery decisions;
- retry decisions;
- detecting which operations have already been completed;
- preventing some duplicated internal operations.

The processing step must not be treated as a replacement for idempotency guarantees when dealing with external side effects.

---

## Initial Order Flow

### Order Creation

1. The client sends a request to create an order.
2. The request contains the `accountId` that should be debited.
3. The API validates the request.
4. The system verifies that the user does not already have an active order.
5. The system verifies that the referenced account exists and can be used by the user.
6. The order is persisted with:

```text
status = PENDING
processingStep = PENDING_CREATED
```

7. A message is published to RabbitMQ.
8. The worker consumes the message.

### Order Processing

When the worker starts processing:

```text
status = PROCESSING
processingStep = PROCESSING_STARTED
```

After validating the account:

```text
status = PROCESSING
processingStep = PROCESSING_ACCOUNT_VALIDATED
```

After successfully debiting the account:

```text
status = PROCESSING
processingStep = PROCESSING_ACCOUNT_DEBITED
```

Before calling the payment provider:

```text
status = PROCESSING
processingStep = PROCESSING_PAYMENT_REQUESTED
```

After receiving payment confirmation:

```text
status = PROCESSING
processingStep = PROCESSING_PAYMENT_CONFIRMED
```

When processing is fully completed:

```text
status = PAID
processingStep = PAID_COMPLETED
```

If the account does not contain enough funds:

```text
status = FAILED
processingStep = FAILED_INSUFFICIENT_FUNDS
```

If payment processing ultimately fails:

```text
status = FAILED
processingStep = FAILED_PAYMENT
```

If a pending order is cancelled:

```text
status = CANCELLED
processingStep = CANCELLED_BY_USER
```

A user may create another order only after the previous order reaches a terminal state.

---

# Non-Functional Requirements

## Reliability

An accepted order should not be silently lost if an internal component temporarily fails.

The system should provide a recovery strategy for failures that occur after the order is persisted but before the corresponding RabbitMQ message is successfully processed.

Temporary worker or payment-processing failures should not result in inconsistent order or account state.

The persisted `processingStep` should provide enough information to identify the last known durable step reached by an order.

---

## Consistency

PostgreSQL must represent the current known state of both orders and accounts.

Invalid order state transitions should be prevented.

For example:

```text
PAID -> CANCELLED
```

must not be possible.

The system must guarantee the following business invariants:

> A user can have at most one active order at a time.

> An account balance must never become negative.

> A successful debit must not be applied more than once for the same logical operation.

These invariants must remain valid even when multiple requests or workers operate concurrently.

### Status and Processing Step Consistency

`status` and `processingStep` must remain logically consistent.

For example:

```text
status = PROCESSING
processingStep = PROCESSING_ACCOUNT_DEBITED
```

is valid.

The following combination should never exist:

```text
status = PAID
processingStep = PROCESSING_ACCOUNT_VALIDATED
```

Whenever possible, changes to `status` and `processingStep` should happen atomically inside the same database transaction.

The prefix of `processingStep` should correspond to the current `status`.

---

## Idempotency

The system must handle idempotency at two different levels.

### Order Creation Idempotency

Repeated client requests representing the same logical order creation must not create duplicated orders.

The client should provide an idempotency key.

Example:

```http
POST /orders
Idempotency-Key: order-create-abc123
```

The idempotency key must be persisted and protected by a unique database constraint.

### Order Processing Idempotency

RabbitMQ may deliver the same message more than once.

A repeated message for the same order must not cause completed operations to be executed multiple times.

The persisted `processingStep` can help the worker understand which internal operations have already been completed.

Example:

```text
Order received again

status = PROCESSING
processingStep = PROCESSING_ACCOUNT_DEBITED
```

The worker now knows that the account debit step has already been completed and must not blindly execute the same debit again.

However, `processingStep` alone does not guarantee exactly-once processing for external side effects.

For example:

```text
Payment Provider successfully processes payment
        ↓
Worker crashes
        ↓
PROCESSING_PAYMENT_CONFIRMED was never persisted
```

When the message is retried, PostgreSQL cannot determine solely from `processingStep` whether the provider processed the payment.

External operations therefore require their own idempotency strategy.

---

## Concurrency

Multiple HTTP requests and multiple workers may operate concurrently.

The system must prevent:

- multiple active orders for the same user;
- invalid order state transitions;
- duplicated payment processing;
- duplicated account debits;
- lost balance updates;
- negative account balances;
- inconsistent processing steps;
- inconsistent updates caused by concurrent operations.

Different orders may reference the same account.

Therefore, account updates require a concurrency-safe strategy.

---

## Performance

Order creation should respond quickly without waiting for payment processing to complete.

Order listing should remain efficient as the number of historical orders increases.

Queries for active orders should remain efficient.

Account balance updates should avoid unnecessary locking while preserving consistency.

---

## Scalability

The order-processing component should be horizontally scalable by adding additional workers.

Adding more workers must not compromise:

- order consistency;
- processing-step consistency;
- account balance integrity;
- idempotency.

---

# Initial Architecture

The system will initially contain four main components:

## API

A NestJS HTTP API responsible for:

- request validation;
- authentication and authorization boundaries;
- order creation;
- order queries;
- order cancellation;
- validating referenced accounts;
- enforcing business rules at the application layer;
- validating idempotency keys;
- publishing payment jobs.

---

## PostgreSQL

PostgreSQL will be the authoritative source of truth for:

- orders;
- accounts;
- account balances;
- order status;
- internal processing steps;
- idempotency keys;
- timestamps;
- concurrency-control metadata.

The database will also participate in enforcing critical business invariants.

No external ephemeral datastore is required for workflow state.

---

## RabbitMQ

RabbitMQ will decouple HTTP requests from payment processing.

The API will publish an order-processing message after an order is created.

Workers will consume these messages and perform account debit and payment processing asynchronously.

RabbitMQ delivery must be assumed to potentially occur more than once.

Consumers must therefore be idempotent.

---

## Worker

The worker will:

1. Receive an order-processing message.
2. Retrieve the current durable order state.
3. Inspect `status` and `processingStep`.
4. Determine whether the order can still be processed.
5. Transition the order to the next valid processing step.
6. Attempt to debit the associated account safely when required.
7. Detect insufficient funds or concurrent account modifications.
8. Execute the payment operation when required.
9. Persist each durable workflow transition.
10. Retry temporary failures according to the configured retry strategy.

---

# Database Consistency and Processing Decisions

## One Active Order per User

A user must never have more than one order whose status is:

- `PENDING`
- `PROCESSING`

This invariant is enforced directly by PostgreSQL using a partial unique index:

```sql
CREATE UNIQUE INDEX unique_active_order_per_user
ON orders (user_id)
WHERE status IN ('PENDING', 'PROCESSING');
```

This allows users to keep any number of historical orders in terminal states while guaranteeing that only one active order exists at a time.

Application-level validation may still be performed to provide a clearer API response, but PostgreSQL is responsible for enforcing the invariant under concurrent requests.

If two concurrent requests attempt to create active orders for the same user, only one insert can succeed.

---

## Processing Step Transitions

The application defines explicit valid transitions between durable processing steps.

Main successful flow:

```text
PENDING_CREATED
        ↓
PROCESSING_STARTED
        ↓
PROCESSING_ACCOUNT_VALIDATED
        ↓
PROCESSING_ACCOUNT_DEBITED
        ↓
PROCESSING_PAYMENT_REQUESTED
        ↓
PROCESSING_PAYMENT_CONFIRMED
        ↓
PAID_COMPLETED
```

Cancellation flow:

```text
PENDING_CREATED
        ↓
CANCELLED_BY_USER
```

Insufficient funds flow:

```text
PROCESSING_ACCOUNT_VALIDATED
        ↓
FAILED_INSUFFICIENT_FUNDS
```

Payment failure flow:

```text
PROCESSING_PAYMENT_REQUESTED
        ↓
FAILED_PAYMENT
```

The application must prevent processing steps from being executed out of order.

`status` and `processingStep` must be updated consistently and, whenever they change together, inside the same database transaction.

---

## Recovery Using Processing Steps

When a worker receives an order, it must inspect its persisted `status` and `processingStep` before executing the next operation.

Example:

```text
processingStep = PROCESSING_ACCOUNT_VALIDATED
```

The worker knows that account validation has already completed and may continue with the debit operation.

Another example:

```text
processingStep = PROCESSING_ACCOUNT_DEBITED
```

The worker must not execute the account debit again.

The processing step acts as a durable workflow checkpoint and allows the worker to determine which internal operations have already completed.

For external side effects, such as calls to the payment provider, the processing step is not sufficient by itself to guarantee exactly-once execution.

---

## Account Debit Strategy

Account debits are executed using an atomic conditional update.

```sql
UPDATE accounts
SET
    balance = balance - :amount,
    updated_at = now()
WHERE id = :accountId
AND balance >= :amount;
```

The result of the update determines whether the debit succeeded.

If:

```text
affectedRows = 1
```

the account had enough funds and the debit was successfully applied.

If:

```text
affectedRows = 0
```

the debit was not performed.

The application must then determine the corresponding failure reason, such as:

- account not found;
- insufficient funds.

This strategy avoids a read-before-write race condition.

Example:

```text
Account balance = 100

Worker A -> debit 80
Worker B -> debit 70
```

Both workers execute the conditional update directly against PostgreSQL.

Possible result:

```text
Worker A:
100 - 80 = 20
affectedRows = 1

Worker B:
20 >= 70 -> false
affectedRows = 0
```

Final state:

```text
Account balance = 20

Order A -> debit successful
Order B -> FAILED_INSUFFICIENT_FUNDS
```

The database constraint:

```sql
CHECK (balance >= 0)
```

remains as an additional persistence-level safety mechanism.

The account has no `version` field. Balance modifications update `updated_at`; concurrency safety comes from the atomic conditional update, not from a version counter.

---

## Account Authorization

The API receives an `accountId` from the client.

The system must verify that:

- the account exists;
- the requesting user is authorized to use the account.

Multiple users may reference the same account so concurrent account operations can occur.

---

## Debit and Payment Ordering

The processing sequence is:

```text
Validate account
        ↓
PROCESSING_ACCOUNT_VALIDATED
        ↓
Atomic account debit
        ↓
PROCESSING_ACCOUNT_DEBITED
        ↓
PROCESSING_PAYMENT_REQUESTED
        ↓
Payment Provider
        ↓
PROCESSING_PAYMENT_CONFIRMED
        ↓
PAID_COMPLETED
```

If the atomic debit affects zero rows because the account does not have sufficient funds:

```text
PROCESSING_ACCOUNT_VALIDATED
        ↓
FAILED_INSUFFICIENT_FUNDS
```

Payment-provider failures transition the order to:

```text
FAILED_PAYMENT
```

Retries must never cause the account debit to be executed again after `PROCESSING_ACCOUNT_DEBITED` has been persisted.

---

## External Payment Idempotency

`processingStep` cannot completely solve failures around external provider calls.

Example:

```text
PROCESSING_PAYMENT_REQUESTED persisted
        ↓
Provider successfully processes payment
        ↓
Worker crashes before persisting confirmation
```

PostgreSQL still contains:

```text
PROCESSING_PAYMENT_REQUESTED
```

After retry, the system cannot safely infer from the internal processing step alone whether the provider already processed the payment.

External payment requests should therefore use an idempotency identifier when the payment provider supports it.

The order ID can be used as the stable identifier for the logical payment operation.

---

## Message Publishing Reliability

An order is persisted before its processing message is published to RabbitMQ.

If publication temporarily fails, the API or publishing mechanism must retry the publication without creating a second order.

The persisted order and its idempotency key remain the authoritative records for the logical order.

---

## Duplicate Message Processing

RabbitMQ may deliver the same message more than once.

The worker must inspect the persisted order state before performing operations.

Example:

```text
Message #1
   ↓
PROCESSING_ACCOUNT_DEBITED

Worker crashes

Message #1 redelivered
   ↓
Worker reads PROCESSING_ACCOUNT_DEBITED
   ↓
Account debit is skipped
```

Processing steps are therefore part of the idempotent-consumer design.

Critical side effects must additionally have their own consistency guarantees.

---

## Retry Strategy

Temporary processing failures may be retried.

Retries must never cause:

- duplicated account debits;
- duplicated external payments;
- invalid processing-step transitions.

Retries always resume from the last durable `processingStep`.

---

## Cancellation Semantics

A user can cancel an order only while:

```text
status = PENDING
processingStep = PENDING_CREATED
```

Successful cancellation produces:

```text
status = CANCELLED
processingStep = CANCELLED_BY_USER
```

Cancellation and worker processing may race:

```text
Cancellation:
PENDING_CREATED
      ↓
CANCELLED_BY_USER

Worker:
PENDING_CREATED
      ↓
PROCESSING_STARTED
```

Only one transition may succeed.

Once the order has transitioned to `PROCESSING`, cancellation is rejected.

---

# Initial Trade-Offs

## Asynchronous Payment Processing

**Decision**

Payment processing will happen asynchronously instead of inside the HTTP request.

**Advantages**

- Faster API response.
- Better isolation from payment-processing latency.
- Easier retry handling.
- Workers can scale independently from the API.

**Disadvantages**

- Increased architecture complexity.
- Eventual consistency.
- Clients cannot immediately know whether the payment succeeded.
- More failure scenarios must be handled.

---

## PostgreSQL as Source of Truth

**Decision**

PostgreSQL will contain the authoritative state of orders, accounts and processing steps.

**Advantages**

- Durable workflow state.
- Transactions.
- Strong consistency.
- Constraints.
- Mature querying capabilities.
- Business invariants can be enforced at the database level.
- Recovery decisions can use persisted workflow state.

**Disadvantages**

- More frequent writes as processing steps change.
- Database concurrency must be handled correctly.
- Incorrect locking strategies may reduce throughput.
- High-contention accounts may become bottlenecks.

---

## Persistent Processing Steps

**Decision**

Internal workflow progress will be persisted directly on each order through `processingStep`.

**Advantages**

- Durable internal state.
- Easier debugging.
- Better observability.
- Workers can determine the last known processing step after retries or crashes.
- No additional infrastructure is required.
- Processing history is tied directly to the source-of-truth record.

**Disadvantages**

- Introduces additional state-machine complexity.
- Every relevant processing transition requires a database write.
- Invalid combinations between `status` and `processingStep` must be prevented.
- A processing step cannot by itself guarantee exactly-once execution of external side effects.

---

## Atomic Conditional Account Debit

**Decision**

Account balance modifications will use an atomic conditional `UPDATE`.

```sql
UPDATE accounts
SET
    balance = balance - :amount,
    updated_at = now()
WHERE id = :accountId
AND balance >= :amount;
```

**Advantages**

- Prevents read-before-write race conditions.
- Evaluates the balance condition and debit atomically.
- Works correctly with concurrent workers.
- Does not require long-lived row locks.
- Provides simple success detection through `affectedRows`.

**Disadvantages**

- An update affecting zero rows requires the application to distinguish between insufficient funds and a missing account.
- More complex account operations may eventually require additional transaction logic.

The account has no `version` field. Each balance modification explicitly updates `updated_at`.

---

## PostgreSQL Partial Unique Index for Active Orders

**Decision**

PostgreSQL will enforce the one-active-order-per-user rule using:

```sql
CREATE UNIQUE INDEX unique_active_order_per_user
ON orders (user_id)
WHERE status IN ('PENDING', 'PROCESSING');
```

**Advantages**

- Prevents race conditions between concurrent API requests.
- Allows unlimited historical orders in terminal states.
- Keeps the invariant valid regardless of which application instance performs the write.
- Enforces the business rule at the persistence layer.

**Disadvantages**

- Uses PostgreSQL-specific partial-index functionality.
- Constraint violations must be translated into meaningful API errors.
- Application-level validation is still useful for clearer responses.

---

## RabbitMQ for Message Processing

**Decision**

RabbitMQ will be used as the message broker.

**Advantages**

- Mature message broker.
- Acknowledgements.
- Retry and dead-letter mechanisms.
- Supports multiple consumers.
- Allows API and workers to scale independently.

**Disadvantages**

- Additional infrastructure.
- Delivery is not exactly once.
- Consumers must handle duplicated messages.
- Database persistence and message publication are not part of the same transaction.

---

# System Diagram

```text
                    ┌─────────────────┐
                    │     Client      │
                    └────────┬────────┘
                             │ HTTP
                             ▼
                    ┌─────────────────┐
                    │    NestJS API   │
                    └───────┬─┬───────┘
                            │ │
                   persist  │ │ publish
                            │ │
                            ▼ ▼
                ┌──────────────┐    ┌─────────────┐
                │ PostgreSQL   │    │  RabbitMQ   │
                │              │    └──────┬──────┘
                │ Orders       │           │
                │ Accounts     │           │ consume
                │ Process Step │           ▼
                └──────▲───────┘    ┌─────────────┐
                       │            │   Worker    │
                       │            └──────┬──────┘
                       │                   │
                       │ state/debit       │
                       └───────────────────┤
                                           │
                                           ▼
                                 ┌──────────────────┐
                                 │ Payment Provider │
                                 └──────────────────┘
```

---

# Data Model

## Order

```text
Order
--------------------------------
id                  UUID
idempotencyKey      VARCHAR
userId              UUID
accountId           UUID
amount              DECIMAL
currency            VARCHAR
status              ENUM
processingStep      ENUM
createdAt           TIMESTAMP
updatedAt           TIMESTAMP
```

### Status

```text
PENDING
PROCESSING
PAID
FAILED
CANCELLED
```

### Processing Steps

Initial processing steps:

```text
PENDING_CREATED

PROCESSING_STARTED
PROCESSING_ACCOUNT_VALIDATED
PROCESSING_ACCOUNT_DEBITED
PROCESSING_PAYMENT_REQUESTED
PROCESSING_PAYMENT_CONFIRMED

PAID_COMPLETED

FAILED_INSUFFICIENT_FUNDS
FAILED_PAYMENT

CANCELLED_BY_USER
```

Additional processing steps may be introduced if new meaningful durable boundaries appear.

A processing step should represent a **durable milestone**, not every individual line or method executed by the worker.

### Initial SQL Representation

```sql
CREATE TABLE orders (
    id UUID PRIMARY KEY,
    idempotency_key VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL,
    account_id UUID NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    status VARCHAR(20) NOT NULL,
    processing_step VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT unique_order_idempotency_key
        UNIQUE (idempotency_key)
);
```

The following business invariant must be enforced:

> A user may have at most one order whose status is `PENDING` or `PROCESSING`.

```sql
CREATE UNIQUE INDEX unique_active_order_per_user
ON orders (user_id)
WHERE status IN ('PENDING', 'PROCESSING');
```

---

## Account

```text
Account
--------------------------------
id              UUID
balance         DECIMAL
createdAt       TIMESTAMP
updatedAt       TIMESTAMP
```

Initial SQL representation:

```sql
CREATE TABLE accounts (
    id UUID PRIMARY KEY,
    balance NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT account_balance_non_negative
        CHECK (balance >= 0)
);
```

The database-level constraint:

```sql
CHECK (balance >= 0)
```

provides an additional safety mechanism ensuring that an account cannot persist a negative balance.

The order references its account:

```sql
ALTER TABLE orders
ADD CONSTRAINT fk_orders_account
FOREIGN KEY (account_id)
REFERENCES accounts(id);
```

---

## Timestamp Defaults

Both tables use `TIMESTAMP NOT NULL DEFAULT now()` for `created_at` and `updated_at`.
PostgreSQL supplies the timestamp on insert when the column is omitted; explicitly
provided application timestamps take precedence. Setting these defaults does not
modify existing rows.

There is no database trigger for `updated_at`. TypeORM manages it through
`@UpdateDateColumn` during its update operations; direct SQL updates must set
`updated_at = now()` explicitly. A default applies to inserts, not updates.

The executable initial schema, including checks for status/step consistency, is
in `scripts/sql/001-create-schema.sql`. Execution instructions are in
`scripts/sql/README.md`. Keep `synchronize: false`: the Nest startup validator
reports TypeORM schema differences without applying them.

# API Contract

## Create Order

`POST /orders`

Header:

```http
Idempotency-Key: order-create-abc123
```

Request:

```json
{
  "amount": 120.50,
  "currency": "USD",
  "userId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "accountId": "a27ac10b-84cc-4372-a567-0e02b2c3d111"
}
```

`accountId` identifies the account that should be debited when the order is processed.

The API must validate that:

- the account exists;
- the user is allowed to use the account;
- the user does not already have an active order;
- the idempotency key is valid.

The definitive account-balance validation happens during asynchronous processing because the account balance may change between:

```text
Order Creation
      ↓
RabbitMQ
      ↓
Worker Processing
```

Initial response:

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "accountId": "a27ac10b-84cc-4372-a567-0e02b2c3d111",
  "status": "PENDING",
  "processingStep": "PENDING_CREATED",
  "amount": 120.50,
  "currency": "USD"
}
```

Suggested status:

`202 Accepted`

If the user already has an active order:

`409 Conflict`

Example:

```json
{
  "statusCode": 409,
  "message": "User already has an active order"
}
```

---

## Get Order

`GET /orders/:id`

Response:

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "accountId": "a27ac10b-84cc-4372-a567-0e02b2c3d111",
  "status": "PROCESSING",
  "processingStep": "PROCESSING_ACCOUNT_DEBITED",
  "amount": 120.50,
  "currency": "USD",
  "createdAt": "2026-10-06T15:00:00Z",
  "updatedAt": "2026-10-06T15:00:04Z"
}
```

`processingStep` is returned by the API in this project so the current durable workflow checkpoint can be inspected.

---

## List Orders

`GET /orders`

Potential query parameters:

```text
?page=1
&limit=20
&status=PAID
```

Response:

```json
{
  "items": [],
  "page": 1,
  "limit": 20,
  "total": 0
}
```

The result must contain only orders belonging to the requesting user.

---

## Cancel Order

`POST /orders/:id/cancel`

Cancellation is valid only when:

```text
status = PENDING
processingStep = PENDING_CREATED
```

Successful cancellation produces:

```text
status = CANCELLED
processingStep = CANCELLED_BY_USER
```

Response:

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "CANCELLED",
  "processingStep": "CANCELLED_BY_USER"
}
```

If the worker has already successfully transitioned the order to `PROCESSING`, cancellation must be rejected.

The implementation must correctly handle the race condition between:

```text
PENDING_CREATED -> CANCELLED_BY_USER
```

and:

```text
PENDING_CREATED -> PROCESSING_STARTED
```

Only one transition may succeed.
