# Async Order - System Design

## Reading This Document

This document combines design requirements with implementation notes. Requirements
and intended guarantees are not all implemented. The current application runs
the HTTP API and the main RMQ consumer in one NestJS process, uses a local account
debit, and has no external payment-provider integration.

Implemented messaging: two clients registered in `QueueModule`, manual consumer
acknowledgements, and up to three retries with a fixed 5-second delay. Backoff,
jitter, and a final failure DLQ are deliberately outside the current scope.
Debit concurrency, atomic debit/finalization, and initial-publication recovery
remain correctness work, not optional retry enhancements.

## Functional Requirements

The system must allow a user to:

- Create an order associated with an account to be debited.
- Retrieve an order by ID.
- Retrieve all their orders.
- Cancel an order while it is still pending.
- Track the current status of an order.

Once an order is created, the payment process must be executed asynchronously.

### Active Order Constraint

A user can have multiple active orders with different body-derived idempotency keys.

An order is considered active when its status is:

- `PENDING`
- `PROCESSING`

An identical request cannot create another order until the matching active order
reaches a terminal state and the interceptor's 10-second TTL expires:

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
processingStep: PROCESSING_ACCOUNT_VALIDATED
```

This means that the order is still processing and its account eligibility was
validated. It does not mean that the balance was debited or payment succeeded.

The current processing switch uses `PENDING_CREATED`, `PROCESSING_STARTED`,
`PROCESSING_ACCOUNT_VALIDATED`, `PAID_COMPLETED`, and `CANCELLED_BY_USER`.
`FAILED_INSUFFICIENT_FUNDS` and `FAILED_PAYMENT` are handled as terminal steps.
The older debit/request/confirmation steps remain
in the enum and SQL checks for now; they are not part of the current workflow.

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
4. The system verifies that no order with the same idempotency key is active.
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

After checking that the account exists and is active and valid:

```text
status = PROCESSING
processingStep = PROCESSING_ACCOUNT_VALIDATED
```

From `PROCESSING_ACCOUNT_VALIDATED`, attempt the payment and record its final
result without separate debit/request/confirmation checkpoints. This checkpoint
does not validate sufficient balance or reserve funds. Account eligibility can
change after validation and must still hold when the debit is applied.

When the payment is successfully completed:

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

Implementation status: the processing use case is in progress. The account
entity has no active/valid fields yet, and the current validation checks only
existence. The validated-account switch branch now invokes the account debit.
The worker attempts a local debit and then records the final order state in a
separate operation. Atomic debit/finalization remains pending, while the
consumer acknowledges and uses a bounded fixed-delay retry queue. The
transitions above describe the intended behavior, not guarantees
already implemented by the full payment flow.

An identical request may create another order only after its matching order is
terminal and the local request TTL expires. Different keys allow multiple active
orders for the same user.

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

> An idempotency key can belong to at most one active order at a time.

> An account balance must never become negative.

> A successful debit must not be applied more than once for the same logical operation.

These invariants must remain valid even when multiple requests or workers operate concurrently.

### Status and Processing Step Consistency

`status` and `processingStep` must remain logically consistent.

For example:

```text
status = PROCESSING
processingStep = PROCESSING_ACCOUNT_VALIDATED
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

Identical requests must not create simultaneous active orders. A new identical
payment is allowed after the previous order is terminal and the local TTL expires.

The create-order interceptor generates a SHA-256 key from the canonical JSON
request body and a UUID trace ID, returned through `X-Trace-Id`. Identical bodies
are rejected with HTTP 409 for 10 seconds using an instance-local Map, including
when the first request fails. Object property order does not affect the hash.

The key is persisted and protected by a partial unique index for `PENDING` and
`PROCESSING` orders. An identical active order returns HTTP 409 even after the
local TTL. Once an order is terminal, an identical payment can create a new order.
This is duplicate suppression while active, not permanent replay of a logical
request. PostgreSQL constraints provide protection across application instances.

The TTL is `10_000` milliseconds, measured from reservation before controller
execution. Duplicate requests do not renew it. The Map is cleared on shutdown
and lost on restart; it is not a distributed lock and may expire while a request
is still executing. Database constraints remain the final concurrency guard.

The hash covers the entire parsed body, with recursively sorted object keys.
Array order and JSON values remain significant. It does not include the trace ID
or a client header. Each request reaching the interceptor receives a fresh trace,
including rejected duplicates. The controller passes both generated values to
the use case, whose logs use that trace. The trace is not currently persisted or
propagated to the RabbitMQ event.

The repository searches the hash only among active orders. An active hash match
causes a domain conflict; other active orders for the same user are allowed.
The repository also maps PostgreSQL `23505` violations of the active idempotency
index to domain conflicts, covering races between validation and insertion.

This allows a retry after a completed payment to create another payment once
the TTL expires. Clients must not assume such retries replay the previous result.

### Order Processing Idempotency

RabbitMQ may deliver the same message more than once.

A repeated message for the same order must not cause completed operations to be executed multiple times.

The persisted `processingStep` can help the worker understand which internal operations have already been completed.

Example:

```text
Order received again

status = PAID
processingStep = PAID_COMPLETED
```

The worker ends processing without attempting payment again. A cancelled order
also ends without effects. For a local debit, its balance change and the final
paid state must commit in the same transaction; otherwise a crash between them
could leave the order eligible for a second debit.

However, `processingStep` alone does not guarantee exactly-once processing for external side effects.

For example:

```text
Payment Provider successfully processes payment
        ↓
Worker crashes
        ↓
PAID_COMPLETED was never persisted
```

When the message is retried, PostgreSQL cannot determine solely from `processingStep` whether the provider processed the payment.

External operations therefore require their own idempotency strategy.

---

## Concurrency

Multiple HTTP requests and multiple workers may operate concurrently.

The system must prevent:

- multiple active orders sharing the same idempotency key;
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
- generating request traces and body-derived duplicate keys;
- rejecting duplicate requests within the local TTL;
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
4. End without effects for completed or cancelled orders.
5. Claim an eligible pending order with a conditional transition to `PROCESSING_STARTED`.
6. Validate the account's existence, active status, and validity, recording `PROCESSING_ACCOUNT_VALIDATED`.
7. Attempt payment with sufficient funds and current account eligibility enforced at debit time.
8. Persist the final result; a local debit and `PAID_COMPLETED` must commit together.
9. Reevaluate the current order state on inconsistent-event retries and retry temporary failures according to the consumer policy.

The validation checkpoint alone does not grant exclusive ownership of payment
processing. Concurrent deliveries must not both apply the same order's debit.

---

# Database Consistency and Processing Decisions

## One Active Order per Idempotency Key

An idempotency key must never belong to more than one order whose status is:

- `PENDING`
- `PROCESSING`

This invariant is enforced directly by PostgreSQL using a partial unique index:

```sql
CREATE UNIQUE INDEX unique_active_order_idempotency_key
ON orders (idempotency_key)
WHERE status IN ('PENDING', 'PROCESSING');
```

This allows multiple active orders for the same user when their keys differ,
and allows reusing a key after its previous order is terminal.

Application-level validation may still be performed to provide a clearer API response, but PostgreSQL is responsible for enforcing the invariant under concurrent requests.

If two concurrent requests attempt to create active orders with the same key,
only one insert can succeed. Different keys do not conflict on user identity.

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
PROCESSING_ACCOUNT_VALIDATED
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

The worker knows that account eligibility was checked and may attempt payment.
This checkpoint does not record a balance reservation or debit. Eligibility
must still hold when the account is debited.

Another example:

```text
processingStep = PAID_COMPLETED
```

The worker must end without executing payment again. `CANCELLED_BY_USER` also
ends without effects. Reaching a processing checkpoint on redelivery does not
prove that a previous worker has stopped; safe resumption requires preventing
two workers from performing the same payment concurrently.

If the conditional start transition updates no row, the use case signals
`RETRY_INCONSISTENT_EVENT`. The intended consumer policy is to redeliver with a
bounded delay, reread the order by ID, and dispatch according to its new step.
Paid or cancelled orders then finish without effects. This classification alone
does not schedule retries by itself; the consumer publishes to the retry queue
and acknowledges the original after publisher confirmation. A processing step
is not evidence that the previous worker stopped, so retrying must not permit
concurrent payment effects.

The processing step acts as a durable workflow checkpoint and allows the worker to determine which internal operations have already completed.

For external side effects, such as calls to the payment provider, the processing step is not sufficient by itself to guarantee exactly-once execution.

---

## Account Debit Strategy

The intended account debit uses an atomic conditional update:

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

Implementation gap: `AccountTypeOrmRepository.updateBalance` currently accepts a
previously read balance, sets `balance = previousBalance - amount`, and uses
`MoreThan(amount)` (strict `>`). It does not implement the SQL above: concurrent
updates can overwrite one another, and an exact-balance payment is rejected.
The debit and final order update also do not share a transaction. These issues
must be resolved before claiming concurrency-safe or idempotent local payments.

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
- the account is active and valid at validation time and remains eligible when debited;
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
Attempt payment / atomic debit
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

There is no separate durable debit checkpoint in this flow. For a local payment,
the conditional debit and final paid state must commit together, with protection
against concurrent processing of the same order. Retrying `PAID_COMPLETED` must
not repeat the debit. If a provider is involved, external payment idempotency is
also required; a local database transaction cannot roll back a provider call.

---

## External Payment Idempotency

`processingStep` cannot completely solve failures around external provider calls.

Example:

```text
PROCESSING_ACCOUNT_VALIDATED persisted
        ↓
Provider successfully processes payment
        ↓
Worker crashes before persisting confirmation
```

PostgreSQL still contains:

```text
PROCESSING_ACCOUNT_VALIDATED
```

After retry, the system cannot safely infer from the internal processing step alone whether the provider already processed the payment.

External payment requests should therefore use an idempotency identifier when the payment provider supports it.

The order ID can be used as the stable identifier for the logical payment operation.

---

## Message Publishing Reliability

An order is persisted before its processing message is published to RabbitMQ.

If publication temporarily fails, the API or publishing mechanism must retry the publication without creating a second order.

The persisted order ID is the stable identity of a logical order. Its body-derived
key can be reused by another order after completion, so it must not identify
external payment side effects across distinct orders.

Currently, publication failure is logged with `publicationRecoveryRequired`
after persistence and the error is rethrown. Retrying the HTTP request returns
409 while the order remains active and does not republish the event. An outbox
or another publication recovery mechanism remains to be implemented.

---

## Duplicate Message Processing

RabbitMQ may deliver the same message more than once.

The worker must inspect the persisted order state before performing operations.

Example:

```text
Message #1
   ↓
PAID_COMPLETED (committed with the local debit)

Worker crashes

Message #1 redelivered
   ↓
Worker reads PAID_COMPLETED
   ↓
Account debit is skipped
```

Processing steps are therefore part of the idempotent-consumer design.

Critical side effects must additionally have their own consistency guarantees.

---

## Retry Strategy

Temporary processing failures may be retried.

The consumer uses one additional durable queue, `orders.retry`, with
`x-message-ttl = 5000`, `x-dead-letter-exchange = ''`, and
`x-dead-letter-routing-key = orders` (names follow configuration). RabbitMQ
returns expired messages to the main queue; no retry consumer or timer is used.
This is a fixed delay, not exponential backoff. The main consumer can receive
other messages while a retry waits in the broker.

Both clients are registered with `ClientsModule.registerAsync` in `QueueModule`:
`ORDER_QUEUE_CLIENT` targets the main queue, and `ORDER_RETRY_QUEUE_CLIENT` targets
the retry queue. `OrderRabbitMqPublisher` and `OrderRetryPublisher` use
`lastValueFrom(client.emit(ORDER_CREATED_EVENT, payload))`; Nest manages the AMQP
connections, event envelope, publication confirmation, and client shutdown.
The retry client connects and declares its queue lazily on the first publication.
The retry queue defaults to `<main queue>.retry`, can be overridden through
`RABBITMQ_RETRY_QUEUE`, and must differ from the main queue. Existing declarations
must have matching arguments. Constants live in `src/infrastructure/queue.constants.ts`.

The consumer is started in `src/main.ts` with manual acknowledgements
(`noAck: false`) and `prefetchCount: 1`. The HTTP API and consumer currently run
in the same application; they are logical roles, not separate deployed services.

The payload contains `{ orderId, retryCount }`, starting at zero. A failed
attempt with count below three publishes a persistent Nest pattern/data envelope
with count incremented, waits for broker confirmation, and then acknowledges the
original. Count three is the final retry. On exhaustion, log and acknowledge,
preserving the order's current state; there is no final failure DLQ.
This is four attempts along a normal retry chain, not an overall execution cap:
broker redelivery, failed publications, and duplicate deliveries may add executions.

NOT_FOUND and BAD_REQUEST are discarded with a log and acknowledgement. Payment
failure and insufficient-funds errors already persisted as terminal states are
also acknowledged. Other errors, including `RETRY_INCONSISTENT_EVENT`, follow
the bounded retry policy. Legacy messages without a count start at zero.

The consumer assumes trusted internal producers. It does not manually validate
the order UUID or retry-count type/range. `OrderCreatedEvent` is a compile-time
contract, not runtime validation. If external or untrusted producers are added,
validate at the messaging boundary before relying on that contract.

If retry publication fails, negatively acknowledge the original with requeue
enabled. This exceptional path bypasses the TTL delay and may redeliver quickly.
A lost acknowledgement after successful retry publication may create duplicates.
Classic-queue dead-letter transfer is not confirmed internally, so successful
publication to the retry queue does not guarantee loss-free return routing during
broker failures. Both queues must exist when TTL expiration routes the message.

Retries must never cause:

- duplicated account debits;
- duplicated external payments;
- invalid processing-step transitions.

Retries reread the durable `processingStep`; this alone does not make side
effects safe to repeat. The transaction/idempotency gaps described above remain.

For this learning stage, fixed delay is the settled retry policy. Exponential
backoff (for example, separate TTL queues for 5s, 10s, and 20s), jitter, and a final
DLQ can be considered later if operational needs justify the complexity.

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

PostgreSQL enforces uniqueness of the idempotency key among active orders using:

```sql
CREATE UNIQUE INDEX unique_active_order_idempotency_key
ON orders (idempotency_key)
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

The diagram below shows the intended logical architecture. In the current
implementation API and worker share one process, and the external payment
provider is not integrated; payment is a local PostgreSQL account debit.

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
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX unique_active_order_idempotency_key
ON orders (idempotency_key)
WHERE status IN ('PENDING', 'PROCESSING');
```

The following business invariant must be enforced:

> An idempotency key may belong to at most one order whose status is `PENDING` or `PROCESSING`.

```sql
CREATE UNIQUE INDEX unique_active_order_idempotency_key
ON orders (idempotency_key)
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

For an existing database with the former `unique_order_idempotency_key`
constraint, apply `scripts/sql/002-active-order-idempotency.sql` once. It drops
the global uniqueness constraint and creates the partial active-order index
in a transaction without changing order records. Fresh databases initialized
with the current `001-create-schema.sql` already have the partial idempotency
index and must not run this upgrade. If an existing database also has
`unique_active_order_per_user`, apply `003-remove-active-order-per-user.sql` to
drop it without modifying order records. On the oldest schema, apply `002` and
then `003`; fresh databases need neither. There is no automatic migration runner.

# API Contract

## Create Order

`POST /orders`

The current endpoint generates its own body-derived idempotency key. No
`Idempotency-Key` or `idempotencyId` request header is required or consumed.

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
- the user is allowed to use the account (planned authorization requirement);
- no identical order is currently active.

The interceptor rejects the same body with 409 during its 10-second local TTL
before the use case runs. Account existence and active-key checks are
implemented; account ownership authorization remains planned.

The definitive account-balance validation happens during asynchronous processing because the account balance may change between:

```text
Order Creation
      ↓
RabbitMQ
      ↓
Worker Processing
```

Current response (`201 Created`, Nest's default for this POST):

```json
{
  "orderId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "pending"
}
```

Response header: `X-Trace-Id: <generated UUID>`. Persisted statuses and processing
steps are uppercase; this response currently uses lowercase `pending`.

If the body is within the local TTL or an identical order remains active:

`409 Conflict`

Example:

```json
{
  "statusCode": 409,
  "message": "An identical request was recently received",
  "error": "Conflict"
}
```

The domain conflict message is `An identical order is still being processed`,
including conflicts detected by PostgreSQL during insertion. The global
`InternalServiceErrorFilter` maps `CONFLICT` to Nest's `ConflictException` and
`NOT_FOUND` to `NotFoundException`, preserving their messages. An unknown internal
code returns a generic 500; existing Nest exceptions retain their responses.
An account that does not exist returns 404 with `Provided account does not exist`.

Create, get, list, and cancel endpoints are implemented. Get, list, and cancel
require the temporary `X-User-Id: <UUID>` header. `FakeAuthorizationGuard` checks
its presence and UUID format only. This simulates authorization without
authentication or ownership checks. The header is not passed to the use cases
or repository: get and cancel operate by order ID, and list includes all users.

---

## Get Order

`GET /orders/:id`

Response:

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "accountId": "a27ac10b-84cc-4372-a567-0e02b2c3d111",
  "status": "PROCESSING",
  "processingStep": "PROCESSING_ACCOUNT_VALIDATED",
  "amount": 120.50,
  "currency": "USD",
  "createdAt": "2026-10-06T15:00:00Z",
  "updatedAt": "2026-10-06T15:00:04Z"
}
```

`processingStep` is returned by the API in this project so the current durable workflow checkpoint can be inspected.

Returns 200 for an existing order regardless of its user, 404 for an absent
order, and 400 for missing/invalid header UUID or invalid order UUID.
The response omits `idempotencyKey` and converts PostgreSQL's numeric amount to
a JSON number.

---

## List Orders

`GET /orders`

Optional query parameters (`page=1` and `limit=20` by default):

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

The result contains orders from all users.
The implementation filters only by optional uppercase status, sorts
by `createdAt DESC, id DESC`, and uses offset pagination. Page must be a positive
safe integer, and limit must be between 1 and 100; malformed values return 400.
`total` is the global count matching the optional status, before pagination.

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

The current endpoint returns 200 on success, 404 for an absent
order, and 409 when the order no longer meets the pending conditions (including
repeat cancellation). It performs one conditional UPDATE including order ID,
`PENDING`, and `PENDING_CREATED`, changing status and step together.
If no row changes, a lookup by ID distinguishes 404 from 409. No RabbitMQ
message is published for cancellation.

The implementation must correctly handle the race condition between:

```text
PENDING_CREATED -> CANCELLED_BY_USER
```

and:

```text
PENDING_CREATED -> PROCESSING_STARTED
```

Only one transition may succeed.
The worker claims an order through a conditional transition from `PENDING` and
`PENDING_CREATED`. This protects the initial claim/cancellation race, not the
later debit against concurrent deliveries of the same order.
