-- Upgrade existing databases; run manually after 001 has already been applied.
BEGIN;

ALTER TABLE orders DROP CONSTRAINT unique_order_idempotency_key;

CREATE UNIQUE INDEX unique_active_order_idempotency_key
ON orders (idempotency_key)
WHERE status IN ('PENDING', 'PROCESSING');

COMMIT;
