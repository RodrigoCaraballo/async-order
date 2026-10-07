-- Allow distinct active orders for the same user; keep active hash uniqueness.
BEGIN;

DROP INDEX IF EXISTS public.unique_active_order_per_user;

COMMIT;
