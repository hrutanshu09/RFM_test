-- Remove date_closed column from requisitions
-- Safe to run multiple times

BEGIN;

ALTER TABLE requisitions
    DROP COLUMN IF EXISTS date_closed;

COMMIT;
