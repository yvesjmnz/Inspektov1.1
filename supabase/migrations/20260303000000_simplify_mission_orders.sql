-- Simplify mission order creation: complaint-driven + minimal fields
--
-- Head Inspector fills:
--  - inspectors (via mission_order_assignments)
--  - date_of_inspection
--  - date_of_issuance
-- Complaint provides:
--  - business name/address + complaint details (joined at read/generation time)
--
-- Status meanings are kept as-is:
--  - draft
--  - issued (submitted to director)
--  - for inspection (director approved)
--  - cancelled (director rejected)

BEGIN;

-- Add new structured fields (keep legacy columns like title/content for backward compatibility)
ALTER TABLE mission_orders
  ADD COLUMN IF NOT EXISTS date_of_inspection DATE,
  ADD COLUMN IF NOT EXISTS date_of_issuance DATE,
  ADD COLUMN IF NOT EXISTS template_name TEXT NOT NULL DEFAULT 'MISSION-ORDER-TEMPLATE',
  ADD COLUMN IF NOT EXISTS generated_docx_url TEXT,
  ADD COLUMN IF NOT EXISTS generated_docx_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generated_docx_created_by UUID;

COMMENT ON COLUMN mission_orders.date_of_inspection IS 'Head inspector-entered date of inspection.';
COMMENT ON COLUMN mission_orders.date_of_issuance IS 'Head inspector-entered date of issuance.';
COMMENT ON COLUMN mission_orders.template_name IS 'Name/key of the mission order template used for preview and docx generation.';
COMMENT ON COLUMN mission_orders.generated_docx_url IS 'Storage URL to the generated mission order DOCX.';
COMMENT ON COLUMN mission_orders.generated_docx_created_at IS 'When the DOCX was generated.';
COMMENT ON COLUMN mission_orders.generated_docx_created_by IS 'User who generated the DOCX.';

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_mission_orders_complaint_id ON mission_orders (complaint_id);
CREATE INDEX IF NOT EXISTS idx_mission_orders_status ON mission_orders (status);

COMMIT;
