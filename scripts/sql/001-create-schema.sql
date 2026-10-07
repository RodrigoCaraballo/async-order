-- Source of truth: docs/system-design.md.
-- Initial schema only: existing tables cause an error, not a silent skip.
BEGIN;

CREATE TABLE accounts (
    id UUID PRIMARY KEY,
    balance NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT account_balance_non_negative
        CHECK (balance >= 0)
);

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

    CONSTRAINT fk_orders_account
        FOREIGN KEY (account_id) REFERENCES accounts(id),
    CONSTRAINT order_status_valid
        CHECK (status IN ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED')),
    CONSTRAINT order_processing_step_valid
        CHECK (processing_step IN (
            'PENDING_CREATED',
            'PROCESSING_STARTED',
            'PROCESSING_ACCOUNT_VALIDATED',
            'PROCESSING_ACCOUNT_DEBITED',
            'PROCESSING_PAYMENT_REQUESTED',
            'PROCESSING_PAYMENT_CONFIRMED',
            'PAID_COMPLETED',
            'FAILED_INSUFFICIENT_FUNDS',
            'FAILED_PAYMENT',
            'CANCELLED_BY_USER'
        )),
    CONSTRAINT order_status_processing_step_consistent
        CHECK (split_part(processing_step, '_', 1) = status)
);

CREATE UNIQUE INDEX unique_active_order_idempotency_key
ON orders (idempotency_key)
WHERE status IN ('PENDING', 'PROCESSING');

COMMIT;
