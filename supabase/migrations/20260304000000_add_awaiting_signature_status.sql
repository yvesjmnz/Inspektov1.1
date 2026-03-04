-- Add awaiting_signature status to mission_orders
-- This status is used when the Head Inspector downloads the mission order
-- and it's ready for the Secretary to sign

BEGIN;

-- Drop the existing check constraint if it exists
ALTER TABLE mission_orders
DROP CONSTRAINT IF EXISTS mission_orders_status_check;

-- Add the new check constraint with awaiting_signature status
ALTER TABLE mission_orders
ADD CONSTRAINT mission_orders_status_check
CHECK (status IN ('draft', 'issued', 'for inspection', 'cancelled', 'awaiting_signature'));

COMMIT;
