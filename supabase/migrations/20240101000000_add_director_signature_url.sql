-- Add director_signature_url column to mission_orders table
ALTER TABLE mission_orders
ADD COLUMN director_signature_url TEXT;

-- Add comment for clarity
COMMENT ON COLUMN mission_orders.director_signature_url IS 'URL to the director''s e-signature image, set when mission order is approved';
